import { feature } from "bun:bundle";
import type { LrcLine } from "@/core/parsers/lrcParser";
import { isMetadataLine } from "@/core/parsers/lrcParser";
import {
	buildAmllLyricLines,
	mergeSubLyrics,
} from "@/core/parsers/lyricBuilder";
import { parseYrc } from "@/core/parsers/yrcParser";
import type { v2 } from "@/types/ncm";
import type { AmllLyricContent, AmllLyricLine } from "@/types/ws";
import type { SongInfo } from "@/types/inflink";
import { extractRawLyricData } from "@/utils/format-lyric";
import { isNonScrollingLyric } from "@/utils/lyricDetector";
import { LYRIC_SOURCE_UUID_BUILTIN_NCM } from "@/utils/source";
import { BaseLyricAdapter } from "../BaseLyricAdapter";

/**
 * V2 专用：在结构化翻译行中找到与目标时间戳最接近的行
 *
 * V2 的 tlyric.lines / romalrc.lines 的 time 字段单位不一致：
 * - 部分歌曲为毫秒（与 YRC startTime 一致）
 * - 部分歌曲为秒（需要 *1000）
 * 使用自适应策略：同时尝试两种单位，选择更接近的匹配
 */
function matchByTimestampV2(
	lines: Array<{ time: number; lyric: string }>,
	targetTimeMs: number,
): string {
	if (lines.length === 0) return "";

	// 策略：同时尝试毫秒和秒两种单位，选择差值更小的
	let bestIdxMs = -1, bestDiffMs = Infinity;
	let bestIdxSec = -1, bestDiffSec = Infinity;

	for (let i = 0; i < lines.length; i++) {
		const timeVal = lines[i].time;
		// 尝试毫秒单位
		const diffMs = Math.abs(timeVal - targetTimeMs);
		if (diffMs < bestDiffMs) {
			bestDiffMs = diffMs;
			bestIdxMs = i;
		}
		// 尝试秒单位（转为毫秒）
		const diffSec = Math.abs(timeVal * 1000 - targetTimeMs);
		if (diffSec < bestDiffSec) {
			bestDiffSec = diffSec;
			bestIdxSec = i;
		}
	}

	// 选择更接近的匹配（3000ms 容差）
	const TOLERANCE = 3000;
	if (bestDiffMs <= TOLERANCE && bestDiffMs <= bestDiffSec) {
		return lines[bestIdxMs].lyric;
	}
	if (bestDiffSec <= TOLERANCE && bestDiffSec < bestDiffMs) {
		return lines[bestIdxSec].lyric;
	}
	return "";
}

export class V2LyricAdapter extends BaseLyricAdapter {
	public readonly id = LYRIC_SOURCE_UUID_BUILTIN_NCM;

	private originalGe: v2.NejEventBus["Ge"] | null = null;
	private eventBus: v2.NejEventBus | null = null;

	private baseLyric: AmllLyricContent | null = null;
	private currentOffset: number = 0;
	private lastPlayId: string | null = null;

	public async init(): Promise<boolean> {
		const bus = window.NEJ?.P(
			/* 名字空间申明 */ "nej.v" /* 事件接口名字空间 */,
		);

		if (
			bus &&
			typeof bus.Ge /* _$dispatchEvent */ === "function" &&
			typeof bus.Ge.e9 /* _$aop */ === "function"
		) {
			this.eventBus = bus;
			this.originalGe = bus.Ge;

			this.eventBus.Ge /* _$dispatchEvent */ = this.originalGe.e9(
				/* _$aop */ (event) => {
					const eventName = event.args[1];
					const payload = event.args[2];

					if (typeof eventName !== "string") return;

					try {
						if (eventName === "lrcload") {
							if (feature("DEV")) {
								console.log("截获 lrcload", payload);
							}

							this.handleLrcLoad(payload as v2.LrcLoadPayload);
						} else if (eventName === "lrctimeupdate") {
							this.handleLrcTimeUpdate(payload as v2.LrcTimeUpdatePayload);
						}
					} catch (err) {
						console.error(`[V2LyricAdapter] 处理事件 ${eventName} 失败`, err);
					}
				},
			);

			return true;
		}

		console.warn(
			"[V2LyricAdapter] 未找到 NEJ 框架或无法应用 AOP 拦截。请检查当前版本是否为 2.10.13。",
		);
		return false;
	}

	public destroy(): void {
		if (this.eventBus && this.originalGe) {
			this.eventBus.Ge = this.originalGe;
			this.originalGe = null;
			this.eventBus = null;
		}
		this.baseLyric = null;
		this.currentOffset = 0;
		this.lastPlayId = null;
	}

	public fetchLyric(songInfo?: SongInfo): void {
		// V2 适配器是被动监听 lrcload 事件的，无法主动拉取歌词
		// 如果缓存的是当前歌曲的歌词，重新 emit 以确保 LyricManager 能收到
		if (this.baseLyric) {
			const payloadPlayId = this.lastPlayId;
			if (songInfo && payloadPlayId) {
				// 检查缓存是否属于当前歌曲（避免切歌后 emit 旧歌词）
				if (payloadPlayId.includes(songInfo.ncmId.toString())) {
					this.emitAdjustedLyric();
				}
			} else {
				this.emitAdjustedLyric();
			}
		}
	}

	private handleLrcLoad(payload: v2.LrcLoadPayload) {
		if (!payload?.lyric) {
			console.warn("[V2LyricAdapter] lrcload 事件无 lyric 数据");
			this.dispatch("rawlyric", null);
			this.dispatch("update", null);
			return;
		}

		this.lastPlayId = payload.playid;

		console.log(
			"[V2LyricAdapter] lrcload 数据:",
			`id=${payload.lyric.id}`,
			`nolyric=${payload.lyric.nolyric}`,
			`uncollected=${payload.lyric.uncollected}`,
			`yrc=${payload.lyric.yrc?.lyric ? `${payload.lyric.yrc.lyric.length}字` : "undefined"}`,
			`lrc=${payload.lyric.lrc ? `lines=${payload.lyric.lrc.lines?.length ?? "n/a"}条` : "undefined"}`,
			`tlyric=${payload.lyric.tlyric ? `lines=${payload.lyric.tlyric.lines?.length ?? "n/a"}条` : "undefined"}`,
			`romalrc=${payload.lyric.romalrc ? `lines=${payload.lyric.romalrc.lines?.length ?? "n/a"}条` : "undefined"}`,
		);

		const rawLyricData = extractRawLyricData({
			yrc: payload.lyric.yrc?.lyric,
			lrcLines: payload.lyric.lrc?.lines,
			trans: payload.lyric.tlyric?.lines,
			roma: payload.lyric.romalrc?.lines,
		});

		this.dispatch("rawlyric", rawLyricData);

		this.baseLyric = this.parseV2Payload(payload.lyric);
		if (!this.baseLyric) {
			console.warn("[V2LyricAdapter] 歌词解析返回 null，无法生成 AMLL 歌词");
			this.dispatch("update", null);
			return;
		}

		this.currentOffset = payload.lyric.lrc?.offset ?? 0;

		this.emitAdjustedLyric();
	}

	private handleLrcTimeUpdate(payload: v2.LrcTimeUpdatePayload): void {
		if (!this.baseLyric || !payload.result) return;

		const newOffset = payload.result.offset ?? 0;

		if (newOffset !== this.currentOffset) {
			this.currentOffset = newOffset;
			this.emitAdjustedLyric();
		}
	}

	private emitAdjustedLyric(): void {
		if (!this.baseLyric) return;

		if (this.currentOffset === 0) {
			this.dispatch("update", this.baseLyric);
			return;
		}

		const adjustedLyric = this.applyOffset(this.baseLyric, this.currentOffset);
		this.dispatch("update", adjustedLyric);
	}

	/**
	 * 时间轴平移计算
	 *
	 * 正数 offset 表示歌词提前显示
	 *
	 * 和 v3 不同，v3 修改 offset 后会直接修改 store 中的歌词时间戳，
	 * 但 v2 只会修改负载属性，需要手动计算
	 */
	private applyOffset(
		baseLyric: AmllLyricContent,
		offset: number,
	): AmllLyricContent {
		if (baseLyric.format !== "structured") {
			return baseLyric;
		}

		const adjustedLines: AmllLyricLine[] = baseLyric.lines.map((line) => {
			return {
				...line,
				startTime: Math.max(0, line.startTime - offset),
				endTime: Math.max(0, line.endTime - offset),
				words: line.words?.map((word) => ({
					...word,
					startTime: Math.max(0, word.startTime - offset),
					endTime: Math.max(0, word.endTime - offset),
				})),
			};
		});

		return {
			format: "structured",
			lines: adjustedLines,
		};
	}

	private parseV2Payload(
		lyricObj: NonNullable<v2.LrcLoadPayload["lyric"]>,
	): AmllLyricContent | null {
		if (lyricObj.yrc?.lyric) {
			const allYrcLines = parseYrc(lyricObj.yrc.lyric);

			console.log(
				"[V2LyricAdapter] YRC 解析:",
				`原始长度=${lyricObj.yrc.lyric.length}`,
				`总行数=${allYrcLines.length}`,
			);

			if (allYrcLines.length > 0) {
				const validIndices: number[] = [];
				for (let i = 0; i < allYrcLines.length; i++) {
					const lineText = allYrcLines[i].words
						.map((w) => w.word)
						.join("")
						.trim();
					if (!isMetadataLine(lineText)) {
						validIndices.push(i);
					}
				}

				// 过滤元数据后如果无有效行，fallback 到 LRC 路径
				if (validIndices.length > 0) {
					const filteredYrcLines = validIndices.map((i) => allYrcLines[i]);
					// 基于时间戳匹配翻译/罗马音行（比索引映射更稳健）
					const tRawLines = lyricObj.tlyric?.lines ?? [];
					const rRawLines = lyricObj.romalrc?.lines ?? [];
					// 过滤元数据翻译行
					const tFiltered = tRawLines.filter(
						(l) => !isMetadataLine(l.lyric),
					);
					const rFiltered = rRawLines.filter(
						(l) => !isMetadataLine(l.lyric),
					);

					const tTexts = validIndices.map((vi) => {
						const yrcTime = allYrcLines[vi].startTime;
						return matchByTimestampV2(tFiltered, yrcTime);
					});
					const romaTexts = validIndices.map((vi) => {
						const yrcTime = allYrcLines[vi].startTime;
						return matchByTimestampV2(rFiltered, yrcTime);
					});

					const mergedLines = mergeSubLyrics(filteredYrcLines, tTexts, romaTexts);

					console.log(
						"[V2LyricAdapter] YRC 过滤:",
						`过滤${allYrcLines.length - mergedLines.length}行元数据`,
						`剩余${mergedLines.length}行`,
					);

					if (isNonScrollingLyric(mergedLines) || lyricObj.lrc?.scrollable === 0) {
						console.log("[V2LyricAdapter] YRC 歌词是非滚动歌词，触发 cover 模式");
						return null;
					}

					return {
						format: "structured",
						lines: mergedLines,
					};
				}

				console.log("[V2LyricAdapter] YRC 过滤元数据后无有效行，fallback 到 LRC 路径");
			}
		}

		if (
			lyricObj.lrc &&
			Array.isArray(lyricObj.lrc.lines) &&
			lyricObj.lrc.lines.length > 0
		) {
			// 先建立有效行的索引映射（过滤掉元数据行）
			const hasTranslation = lyricObj.tlyric?.lines && lyricObj.tlyric.lines.length > 0;
			const validIndices: number[] = [];
			const rawLrc: LrcLine[] = [];
			const filteredCount = { metadata: 0, empty: 0 };
			// 当无独立翻译行但 lyric 中包含 "原文/翻译" 时，内联提取的翻译
			const inlineTransTexts: string[] = [];

			for (let i = 0; i < lyricObj.lrc.lines.length; i++) {
				const line = lyricObj.lrc.lines[i];
				if (isMetadataLine(line.lyric)) {
					filteredCount.metadata++;
					continue;
				}

				validIndices.push(i);

				// 当存在独立翻译行时，网易云 LRC 的 lyric 字段可能包含 "原文/翻译" 格式，
				// 需要剥离翻译部分，只保留原文作为正式歌词文本
				let lyricText = line.lyric;
				let inlineTrans = "";

				if (lyricText.includes("/")) {
					if (hasTranslation && lyricObj.tlyric?.lines?.[i]?.lyric) {
						// 有独立翻译行时，剥离 lyric 中 / 后的翻译部分
						const slashIndex = lyricText.lastIndexOf("/");
						const beforeSlash = lyricText.substring(0, slashIndex).trim();
						const afterSlash = lyricText.substring(slashIndex + 1).trim();
						if (afterSlash.length > 0 && beforeSlash.length > 0) {
							lyricText = beforeSlash;
						}
					} else if (!hasTranslation) {
						// 无独立翻译行时，尝试从 "原文/翻译" 中提取内联翻译
						const slashIndex = lyricText.lastIndexOf("/");
						const beforeSlash = lyricText.substring(0, slashIndex).trim();
						const afterSlash = lyricText.substring(slashIndex + 1).trim();
						if (afterSlash.length > 0 && beforeSlash.length > 0) {
							lyricText = beforeSlash;
							inlineTrans = afterSlash;
						}
					}
				}

				inlineTransTexts.push(inlineTrans);
				rawLrc.push({
					// V2 lrc.lines 时间单位不一致：部分歌曲为秒，部分为毫秒
					// 通过首行时间值自动检测：如果 < 1000 认为是秒，需要 *1000
					time: lyricObj.lrc.lines[0].time < 1000 ? line.time * 1000 : line.time,
					text: lyricText,
				});
			}

			if (filteredCount.metadata > 0) {
				console.log(
					"[V2LyricAdapter] LRC 过滤元数据行:",
					`过滤${filteredCount.metadata}行元数据`,
					`剩余${rawLrc.length}行歌词`,
				);
			}

			// 按照有效行索引提取翻译和音译文本
			// 翻译文本：优先使用独立翻译行，否则使用内联提取的翻译
			const allTTexts = lyricObj.tlyric?.lines?.map((l) => l.lyric) ?? [];
			const allRomaTexts =
				lyricObj.romalrc?.lines?.map((l) => l.lyric) ?? [];
			const tTexts = validIndices.map((vi, idx) =>
				allTTexts[vi] || inlineTransTexts[idx] || "",
			);
			const romaTexts = validIndices.map((i) => allRomaTexts[i] || "");

			// 预检查：检测所有行是否都是无时间轴（全0或无效时间戳）
			const validLines = rawLrc.filter((l) => l.text.trim().length > 0);
			if (validLines.length > 0) {
				const allZeroTime = validLines.every((l) => l.time === 0);
				const allSameTime = validLines.every((l) => l.time === validLines[0].time);

				if (allZeroTime || allSameTime) {
					console.log(
						"[V2LyricAdapter] LRC 预检查：所有行时间戳相同或为0，触发 cover 模式",
						`allZeroTime=${allZeroTime}, allSameTime=${allSameTime}`,
					);
					return null;
				}
			}

			console.log(
				"[V2LyricAdapter] LRC 路径:",
				`lrc.lines=${lyricObj.lrc.lines.length}条`,
				`首行 time=${lyricObj.lrc.lines[0]?.time} lyric="${lyricObj.lrc.lines[0]?.lyric?.substring(0, 30)}"`,
				`nolyric=${lyricObj.lrc.nolyric}`,
				`scrollable=${lyricObj.lrc.scrollable}`,
				`offset=${lyricObj.lrc.offset}`,
			);

			const builtLines = buildAmllLyricLines(rawLrc, tTexts, romaTexts);

			console.log(
				"[V2LyricAdapter] LRC 构建完成:",
				`原始${rawLrc.length}行 -> 构建${builtLines.length}行`,
				`首行时间戳=[${builtLines[0]?.startTime ?? "n/a"}, ${builtLines[0]?.endTime ?? "n/a"}]`,
				`isNonScrolling=${isNonScrollingLyric(builtLines)}`,
			);

			if (isNonScrollingLyric(builtLines) || lyricObj.lrc?.scrollable === 0) {
				console.log("[V2LyricAdapter] LRC 歌词是非滚动歌词，触发 cover 模式");
				return null;
			}

			return {
				format: "structured",
				lines: builtLines,
			};
		}

		console.log(
			"[V2LyricAdapter] 所有歌词路径均无效:",
			`yrc=${!!lyricObj.yrc?.lyric}`,
			`lrc=${!!lyricObj.lrc}`,
			`lrc.lines=${lyricObj.lrc?.lines ? (Array.isArray(lyricObj.lrc.lines) ? `${lyricObj.lrc.lines.length}条` : "非数组") : "n/a"}`,
			`nolyric=${lyricObj.lrc?.nolyric}`,
			`uncollected=${lyricObj.lrc?.uncollected}`,
		);

		return null;
	}
}
