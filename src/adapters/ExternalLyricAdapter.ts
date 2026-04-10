import { parseLrc } from "@/core/parsers/lrcParser";
import { buildAmllLyricLines } from "@/core/parsers/lyricBuilder";
import { parseLys } from "@/core/parsers/lysParser";
import { parseQrc } from "@/core/parsers/qrcParser";
import { parseTtml } from "@/core/parsers/ttmlParser";
import { parseYrc } from "@/core/parsers/yrcParser";
import type { SongInfo } from "@/types/inflink";
import type { AmllLyricContent } from "@/types/ws";
import { LyricFormat, type LyricSource } from "@/utils/source";
import { isNonScrollingLyric } from "@/utils/lyricDetector";
import { BaseLyricAdapter } from "./BaseLyricAdapter";

export class ExternalLyricAdapter extends BaseLyricAdapter {
	public readonly id: string;
	private source: LyricSource;

	constructor(source: LyricSource) {
		super();
		this.id = source.id;
		this.source = source;
	}

	public async init(): Promise<boolean> {
		return true;
	}

	public destroy(): void {}

	public async fetchLyric(songInfo: SongInfo): Promise<void> {
		if (!songInfo?.ncmId) return;

		const url = this.buildUrl(songInfo);

		try {
			let text = "";

			if (url.startsWith("file:///")) {
				const filePath = url.replace("file:///", "");

				const isExist = await betterncm.fs.exists(filePath);
				if (!isExist) {
					this.dispatch("rawlyric", null);
					this.dispatch("update", null);
					return;
				}

				text = await betterncm.fs.readFileText(filePath);
			} else {
				const response = await fetch(url);
				if (response.status === 200) {
					text = await response.text();
				} else {
					this.dispatch("rawlyric", null);
					this.dispatch("update", null);
					return;
				}
			}

			this.dispatch("rawlyric", { main: text });
			const parsedLyric = this.parseRawLyric(text, this.source.format);
			this.dispatch("update", parsedLyric);
		} catch (e) {
			console.error(`[ExternalAdapter: ${this.source.name}] 获取歌词失败`, e);
			this.dispatch("rawlyric", null);
			this.dispatch("update", null);
		}
	}

	private parseRawLyric(
		text: string,
		format: LyricFormat,
	): AmllLyricContent | null {
		if (!text.trim()) return null;

		switch (format) {
			case LyricFormat.TTML:
				return parseTtml(text);

			case LyricFormat.LRC: {
				const rawLrc = parseLrc(text);
				if (rawLrc.length === 0) return null;

				const lines = buildAmllLyricLines(rawLrc, [], []);

				// 检测非滚动歌词
				if (isNonScrollingLyric(lines)) {
					console.log("[ExternalAdapter] LRC 歌词是非滚动歌词，触发 cover 模式");
					return null;
				}

				return {
					format: "structured",
					lines,
				};
			}

			case LyricFormat.YRC: {
				const yrcLines = parseYrc(text);
				if (yrcLines.length === 0) return null;

				// 检测非滚动歌词
				if (isNonScrollingLyric(yrcLines)) {
					console.log("[ExternalAdapter] YRC 歌词是非滚动歌词，触发 cover 模式");
					return null;
				}

				return {
					format: "structured",
					lines: yrcLines,
				};
			}

			case LyricFormat.LYS: {
				const lysLines = parseLys(text);
				if (lysLines.length === 0) return null;

				// 检测非滚动歌词
				if (isNonScrollingLyric(lysLines)) {
					console.log("[ExternalAdapter] LYS 歌词是非滚动歌词，触发 cover 模式");
					return null;
				}

				return {
					format: "structured",
					lines: lysLines,
				};
			}

			case LyricFormat.QRC: {
				const qrcLines = parseQrc(text);
				if (qrcLines.length === 0) return null;

				// 检测非滚动歌词
				if (isNonScrollingLyric(qrcLines)) {
					console.log("[ExternalAdapter] QRC 歌词是非滚动歌词，触发 cover 模式");
					return null;
				}

				return {
					format: "structured",
					lines: qrcLines,
				};
			}

			default:
				console.warn(`[ExternalAdapter] 未知的歌词格式: ${format}`);
				return null;
		}
	}

	private buildUrl(songInfo: SongInfo): string {
		let url = this.source.url;
		const ncmId = songInfo.ncmId.toString();
		const name = songInfo.songName || "";
		const artists = songInfo.authorName || "";

		// TODO: 获取别名
		const alias = "";

		url = url.replace(/\[NCM_ID\]/g, ncmId);
		url = url.replace(/\[SONG_NAME\]/g, name);
		url = url.replace(/\[SONG_NAME_URI\]/g, encodeURIComponent(name));
		url = url.replace(/\[SONG_ARTISTS\]/g, artists);
		url = url.replace(/\[SONG_ARTISTS_URI\]/g, encodeURIComponent(artists));
		url = url.replace(/\[SONG_ALIAS\]/g, alias);
		url = url.replace(/\[SONG_ALIAS_URI\]/g, encodeURIComponent(alias));

		return url;
	}
}
