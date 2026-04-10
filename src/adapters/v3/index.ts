import { type LrcLine, isMetadataLine, parseLrc } from "@/core/parsers/lrcParser";
import {
	buildAmllLyricLines,
	mergeSubLyrics,
} from "@/core/parsers/lyricBuilder";
import { parseYrc } from "@/core/parsers/yrcParser";
import type { v3 } from "@/types/ncm";
import type { AmllLyricContent } from "@/types/ws";
import { extractRawLyricData } from "@/utils/format-lyric";
import { isNonScrollingLyric } from "@/utils/lyricDetector";
import { LYRIC_SOURCE_UUID_BUILTIN_NCM } from "@/utils/source";
import {
	findModule,
	getWebpackRequire,
	type WebpackRequire,
} from "@/utils/webpack";
import { BaseLyricAdapter } from "../BaseLyricAdapter";

/**
 * 在 LRC 行中找到与目标时间戳最接近的行，返回其文本
 *
 * 用于 YRC 路径中将翻译/罗马音与歌词行对齐，
 * 因为 yrcTrans/yrcRoma 的行数和索引可能与 yrc 不一致（可能包含或不包含元数据翻译行）
 */
function matchByTimestamp(lines: LrcLine[], targetTime: number): string {
	if (lines.length === 0) return "";

	// 线性扫描找时间最接近的行（通常数据量小，无需二分）
	let bestIdx = -1;
	let bestDiff = Infinity;
	for (let i = 0; i < lines.length; i++) {
		const diff = Math.abs(lines[i].time - targetTime);
		if (diff < bestDiff) {
			bestDiff = diff;
			bestIdx = i;
		}
	}

	// 容差 3 秒内才算有效匹配，否则返回空字符串
	return (bestDiff <= 3000 && bestIdx >= 0) ? lines[bestIdx].text : "";
}

export class V3LyricAdapter extends BaseLyricAdapter {
	public readonly id = LYRIC_SOURCE_UUID_BUILTIN_NCM;

	private store: v3.NCMStore | null = null;
	private unsubscribeRedux: (() => void) | null = null;
	private lastSentLyricJson: string | null = null;
	private lastLyricStateJson: string | null = null;
	private initTimer: ReturnType<typeof setInterval> | null = null;

	public async init(): Promise<boolean> {
		try {
			const requireInstance = await getWebpackRequire();

			return await new Promise<boolean>((resolve) => {
				let attempts = 0;
				const maxAttempts = 20;

				const checkStore = () => {
					attempts++;
					this.store = this.findReduxStoreFromDva(requireInstance);

					if (this.store) {
						if (this.initTimer) clearInterval(this.initTimer);
						this.initTimer = null;

						this.unsubscribeRedux = this.store.subscribe(() => {
							this.handleStoreUpdate();
						});

						this.handleStoreUpdate();
						resolve(true);
					} else if (attempts >= maxAttempts) {
						if (this.initTimer) clearInterval(this.initTimer);
						this.initTimer = null;

						console.warn("[V3LyricAdapter] 寻找 Dva Redux Store 超时");
						resolve(false);
					}
				};

				checkStore();
				if (!this.store && attempts < maxAttempts) {
					this.initTimer = setInterval(checkStore, 1000);
				}
			});
		} catch (e) {
			console.error("[V3LyricAdapter] 初始化失败", e);
			return false;
		}
	}

	public destroy(): void {
		if (this.initTimer) {
			clearInterval(this.initTimer);
			this.initTimer = null;
		}

		if (this.unsubscribeRedux) {
			this.unsubscribeRedux();
			this.unsubscribeRedux = null;
		}

		this.store = null;
		this.lastSentLyricJson = null;
		this.lastLyricStateJson = null;
	}

	private handleStoreUpdate() {
		if (!this.store) return;

		const state = this.store.getState();
		const lyricState = state["async:lyric"];

		if (!lyricState) {
			console.warn("[V3LyricAdapter] async:lyric 状态不存在，store keys:", Object.keys(state));
			return;
		}

		if (lyricState.isLoading) return;

		// 缓存 lyricState 的关键数据，避免每次 Redux 状态变化（如播放进度更新）都重新解析歌词
		const lyricStateKey = JSON.stringify({
			yrc: lyricState.yrcInfo?.yrc,
			yrcTrans: lyricState.yrcInfo?.yrcTrans,
			yrcRoma: lyricState.yrcInfo?.yrcRoma,
			lyricLines: lyricState.lyricLines,
			tlyricLines: lyricState.tlyricLines,
			romaLyricLines: lyricState.romaLyricLines,
			scrollable: lyricState.scrollable,
			displayType: lyricState.displayType,
		});

		if (lyricStateKey === this.lastLyricStateJson) {
			return;
		}
		this.lastLyricStateJson = lyricStateKey;

		const amllLyric = this.parseNcmLyric(lyricState);
		if (!amllLyric) {
			console.log(
				"[V3LyricAdapter] 歌词解析失败",
				`yrcInfo=${!!lyricState.yrcInfo?.yrc}`,
				`lyricLines数量=${lyricState.lyricLines?.length ?? "null/undefined"}`,
				`tlyricLines数量=${lyricState.tlyricLines?.length ?? "null/undefined"}`,
				`isCloudLyric=${lyricState.isCloudLyric}`,
				`isLyricFetchFailed=${lyricState.isLyricFetchFailed}`,
			);
			this.dispatch("rawlyric", null);
			this.dispatch("update", null);
			return;
		}

		const currentJson = JSON.stringify(amllLyric);

		if (currentJson === this.lastSentLyricJson) {
			return;
		}

		this.lastSentLyricJson = currentJson;

		const rawLyricData = extractRawLyricData({
			yrc: lyricState.yrcInfo?.yrc,
			lrcLines: lyricState.lyricLines,
			trans: lyricState.yrcInfo?.yrc
				? lyricState.yrcInfo.yrcTrans
				: lyricState.tlyricLines,
			roma: lyricState.yrcInfo?.yrc
				? lyricState.yrcInfo.yrcRoma
				: lyricState.romaLyricLines,
		});

		this.dispatch("rawlyric", rawLyricData);
		this.dispatch("update", amllLyric);
	}

	public fetchLyric(_songInfo?: import("@/types/inflink").SongInfo): void {
		this.lastSentLyricJson = null;
		this.lastLyricStateJson = null;

		// async:lyric 只有在用户打开了会显示歌词的页面或者组件才会有歌词
		// dispatch 这个 action 以便我们无论如何都能获取到歌词
		if (this.store) {
			this.store.dispatch({
				type: "async:lyric/fetchLyric",
				payload: { force: true },
			});
		}
	}

	private parseNcmLyric(
		rawState: v3.NcmAsyncLyricState,
	): AmllLyricContent | null {
		if (rawState.yrcInfo?.yrc) {
			const yrcInfo = rawState.yrcInfo;
			const allYrcLines = parseYrc(yrcInfo.yrc);

			console.log("[V3LyricAdapter] YRC 解析:", `原始长度=${yrcInfo.yrc.length}`, `解析行数=${allYrcLines.length}`);

			if (allYrcLines.length > 0) {
				// 过滤元数据行（与 V2 对齐）
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
					const yrcLines = validIndices.map((i) => allYrcLines[i]);
					// 翻译/罗马音解析：不过滤元数据（因为无法确定 yrcTrans 是否包含元数据翻译行）
					// 使用基于时间戳匹配的方式对齐翻译和歌词行
					const tRaw = parseLrc(yrcInfo.yrcTrans || "", { skipMetadataFilter: true });
					const rRaw = parseLrc(yrcInfo.yrcRoma || "", { skipMetadataFilter: true });

					// 基于时间戳匹配：对于每个有效 YRC 行，在翻译中找时间最接近的行
					// 这比索引映射更稳健——无论 yrcTrans 是否包含元数据翻译行都能正确工作
					const tTexts = validIndices.map((vi) => {
						const yrcTime = allYrcLines[vi].startTime;
						return matchByTimestamp(tRaw, yrcTime);
					});
					const romaTexts = validIndices.map((vi) => {
						const yrcTime = allYrcLines[vi].startTime;
						return matchByTimestamp(rRaw, yrcTime);
					});

					const mergedLines = mergeSubLyrics(yrcLines, tTexts, romaTexts);

					if (isNonScrollingLyric(mergedLines) || rawState.scrollable === false) {
						console.log("[V3LyricAdapter] YRC 歌词是非滚动歌词，触发 cover 模式");
						return null;
					}

					return {
						format: "structured",
						lines: mergedLines,
					};
				}

				console.log("[V3LyricAdapter] YRC 过滤元数据后无有效行，fallback 到 LRC 路径");
			}
		}

		const lines = rawState.lyricLines;
		console.log(
			"[V3LyricAdapter] 尝试 LRC 路径:",
			`lyricLines=${lines ? (Array.isArray(lines) ? `${lines.length}行` : "非数组") : "null/undefined"}`,
			`tlyricLines=${rawState.tlyricLines?.length ?? "n/a"}行`,
			`romaLyricLines=${rawState.romaLyricLines?.length ?? "n/a"}行`,
			`displayType=${rawState.displayType}`,
			`currentUsedLyric=${rawState.currentUsedLyric?.substring(0, 50) ?? "n/a"}`,
		);

		if (!lines || !Array.isArray(lines) || lines.length === 0) {
			return null;
		}

		// 使用与 V2 一致的索引映射方式，确保翻译和罗马音对齐
		const hasTranslation = rawState.tlyricLines && rawState.tlyricLines.length > 0;
		const validIndices: number[] = [];
		const rawLrc: LrcLine[] = [];
		// 当无独立翻译行但 lyric 中包含 "原文/翻译" 时，内联提取的翻译
		const inlineTransTexts: string[] = [];

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			if (isMetadataLine(line.lyric)) {
				continue;
			}

			validIndices.push(i);

			// 当存在独立翻译行时，网易云 LRC 的 lyric 字段可能包含 "原文/翻译" 格式，
			// 需要剥离翻译部分，只保留原文作为正式歌词文本
			let lyricText = line.lyric;
			let inlineTrans = "";

			if (lyricText.includes("/")) {
				if (hasTranslation && rawState.tlyricLines?.[i]?.lyric) {
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
			// V3 lyricLines 时间单位不一致：部分歌曲为秒，部分为毫秒
			// 通过首行时间值自动检测：如果 < 1000 认为是秒，需要 *1000
			time: lines[0].time < 1000 ? line.time * 1000 : line.time,
			text: lyricText,
		});
		}

		// 翻译文本：优先使用独立翻译行，否则使用内联提取的翻译
		const tTexts = validIndices.map((vi, idx) =>
			rawState.tlyricLines?.[vi]?.lyric || inlineTransTexts[idx] || "",
		);
		const romaTexts = validIndices.map(
			(i) => rawState.romaLyricLines?.[i]?.lyric ?? "",
		);

		// 预检查：检测所有行是否都是无时间轴（全0或无效时间戳）
		const validLines = rawLrc.filter((l) => l.text.trim().length > 0);
		if (validLines.length > 0) {
			const allZeroTime = validLines.every((l) => l.time === 0);
			const allSameTime = validLines.every((l) => l.time === validLines[0].time);

			if (allZeroTime || allSameTime) {
				console.log(
					"[V3LyricAdapter] LRC 预检查：所有行时间戳相同或为0，触发 cover 模式",
					`allZeroTime=${allZeroTime}, allSameTime=${allSameTime}`,
				);
				return null;
			}
		}

		const builtLines = buildAmllLyricLines(rawLrc, tTexts, romaTexts);

		console.log(
			"[V3LyricAdapter] LRC 构建完成:",
			`原始${rawLrc.length}行 -> 构建${builtLines.length}行`,
			`首行时间戳=[${builtLines[0]?.startTime ?? "n/a"}, ${builtLines[0]?.endTime ?? "n/a"}]`,
			`isNonScrolling=${isNonScrollingLyric(builtLines)}`,
		);

		if (isNonScrollingLyric(builtLines) || rawState.scrollable === false) {
			console.log("[V3LyricAdapter] LRC 歌词是非滚动歌词，触发 cover 模式");
			return null;
		}

		return {
			format: "structured",
			lines: builtLines,
		};
	}

	private findReduxStoreFromDva(require: WebpackRequire): v3.NCMStore | null {
		try {
			const dvaModule = findModule<v3.DvaToolModule>(
				require,
				(exports: unknown): exports is v3.DvaToolModule => {
					return (
						!!exports &&
						typeof exports === "object" &&
						"a" in exports &&
						!!exports.a &&
						typeof exports.a === "object" &&
						"getStore" in exports.a &&
						typeof exports.a.getStore === "function"
					);
				},
			);

			if (
				dvaModule?.a.inited &&
				dvaModule.a.app?._store &&
				typeof dvaModule.a.app._store.subscribe === "function"
			) {
				return dvaModule.a.app._store;
			}
		} catch (e) {
			console.error("[V3LyricAdapter] 通过 dva-tool 寻找 Store 时发生错误:", e);
		}

		return null;
	}
}
