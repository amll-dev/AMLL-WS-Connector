import type { AmllLyricLine, AmllLyricWord } from "@/types/ws";

/**
 * 网易云新版 JSON 格式的 YRC 单行数据
 */
interface JsonYrcLine {
	t: number; // 行起始时间（毫秒）
	c: Array<{ tx: string }>; // 逐字词组
}

function tryParseJsonYrc(line: string): AmllLyricLine[] | null {
	const trimmed = line.trim();
	if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;

	try {
		const parsed: JsonYrcLine = JSON.parse(trimmed);
		if (typeof parsed.t !== "number" || !Array.isArray(parsed.c) || parsed.c.length === 0) {
			return null;
		}

		const words: AmllLyricWord[] = [];

		for (const chunk of parsed.c) {
			if (!chunk.tx || typeof chunk.tx !== "string") continue;
			const text = chunk.tx.trim();
			if (text.length === 0) continue;

			// JSON 格式中每个 chunk 没有独立的 duration 信息，
			// startTime 设为行起始时间，endTime 由后处理步骤根据下一行回填
			words.push({
				startTime: parsed.t,
				endTime: 0, // 后处理中按字符比例分配并回填
				word: text,
			});
		}

		if (words.length === 0) return null;

		return [
			{
				startTime: parsed.t,
				endTime: 0, // 后处理中回填
				words: words,
				translatedLyric: "",
				romanLyric: "",
			},
		];
	} catch {
		return null;
	}
}

/**
 * 尝试解析 LRC 行级格式 [MM:SS.ms]text 或 [MM:SS:xx]text
 * 网易云有时会将 LRC 格式的歌词混入 yrcInfo.yrc 字段中
 */
function tryParseLrcLine(line: string): AmllLyricLine | null {
	const lrcMatch = line.match(
		/^\[(?<min>\d{1,3}):(?<sec>\d{2})(?:[:.](?<ms>\d{2,3}))?\](?<text>.*)/,
	);
	if (!lrcMatch?.groups) return null;

	const { min, sec, ms, text } = lrcMatch.groups;
	if (!text || text.trim().length === 0) return null;

	const minVal = parseInt(min, 10);
	const secVal = parseInt(sec, 10);
	let msVal = 0;
	if (ms) {
		msVal = parseInt(ms, 10);
		if (ms.length === 2) msVal *= 10;
	}

	const startTime = minVal * 60000 + secVal * 1000 + msVal;
	const trimmedText = text.trim();

	return {
		startTime,
		endTime: startTime + 5000, // 默认5秒，后处理会修正
		words: [{
			startTime,
			endTime: startTime + 5000,
			word: trimmedText,
		}],
		translatedLyric: "",
		romanLyric: "",
	};
}

export function parseYrc(yrcStr: string): AmllLyricLine[] {
	if (!yrcStr) return [];
	const lines = yrcStr.split("\n");
	const rawResult: AmllLyricLine[] = [];

	for (const line of lines) {
		if (!line.trim()) continue;

		// 尝试 JSON 格式解析（新版网易云 YRC）
		const jsonParsed = tryParseJsonYrc(line);
		if (jsonParsed && jsonParsed.length > 0) {
			rawResult.push(...jsonParsed);
			continue;
		}

		// 旧版括号格式解析 [lineStart,lineDur](wStart,wDur,0)text
		const bracketMatch = line.match(
			/^\[(?<lineStart>\d+),(?<lineDur>\d+)\](?<content>.*)/,
		);
		if (bracketMatch?.groups) {
			const content = bracketMatch.groups.content;
			const wordRegex =
				/\((?<wordStart>\d+),(?<wordDur>\d+),\d+\)(?<wordText>.*?)(?=\(\d+,\d+,\d+\)|$)/g;
			const words: AmllLyricWord[] = [];

			for (const match of content.matchAll(wordRegex)) {
				if (!match.groups) continue;
				const { wordStart: startStr, wordDur: durStr, wordText } = match.groups;
				const wordStart = parseInt(startStr, 10);
				const wordDur = parseInt(durStr, 10);

				if (wordText.trim() === "") continue;

				words.push({
					startTime: wordStart,
					endTime: wordStart + wordDur,
					word: wordText,
				});
			}

			if (words.length > 0) {
				rawResult.push({
					startTime: words[0].startTime,
					endTime: words[words.length - 1].endTime,
					words: words,
					translatedLyric: "",
					romanLyric: "",
				});
			}
			continue;
		}

		// LRC 行级格式 fallback [MM:SS.ms]text 或 [MM:SS:xx]text
		// 网易云有时会将 LRC 格式歌词混入 yrc 字段
		const lrcLine = tryParseLrcLine(line);
		if (lrcLine) {
			rawResult.push(lrcLine);
			continue;
		}
	}

	// 后处理：用下一行的 startTime 回填当前行的 endTime
	if (rawResult.length > 0) {
		for (let i = 0; i < rawResult.length; i++) {
			const current = rawResult[i];
			const nextLineStartTime = i + 1 < rawResult.length
				? rawResult[i + 1].startTime
				: current.startTime + 5000;

			current.endTime = Math.max(current.endTime, nextLineStartTime);

			// 检测是否需要修正 word 级别的时间（JSON 和 LRC 解析的行都需要）
			const needsWordFixup = current.words.some(
				(w) => w.endTime <= w.startTime || w.endTime - w.startTime < 50,
			);

			if (needsWordFixup && current.words.length > 0) {
				const lineDuration = current.endTime - current.startTime;
				const totalChars = current.words.reduce(
					(sum, w) => sum + w.word.length, 0,
				);
				let accTime = current.startTime;
				for (let j = 0; j < current.words.length; j++) {
					const word = current.words[j];
					const charRatio = totalChars > 0
						? word.word.length / totalChars
						: 1 / current.words.length;
					const wordDur = Math.round(lineDuration * charRatio);
					word.startTime = accTime;
					word.endTime = accTime + wordDur;
					accTime += wordDur;
				}
				if (current.words.length > 0) {
					current.words[current.words.length - 1].endTime = current.endTime;
				}
			}
		}
	}

	return rawResult;
}
