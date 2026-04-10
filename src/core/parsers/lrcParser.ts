export interface LrcLine {
	/**
	 * 单位为毫秒
	 */
	time: number;
	text: string;
}

/**
 * 元数据关键词 — 用于过滤网易云歌词中的作词、作曲等信息
 */
const METADATA_KEYWORDS = [
	"作词",
	"作曲",
	"制作人",
	"编曲",
	"吉他",
	"贝斯",
	"鼓",
	"键盘",
	"合唱",
	"和声",
	"和音",
	"配乐",
	"弦乐",
	"混音",
	"母带",
	"录制",
	"录音",
	"演唱",
	"词",
	"曲",
	"音乐制作",
	"录音工作室",
	"混音工作室",
	"母带后期",
	"后期",
	"出品",
	"音乐营销",
	"composer",
	"prod",
];

/**
 * 检测歌词行是否为元数据行（作词、作曲等）
 */
export function isMetadataLine(text: string): boolean {
	if (!text) return false;

	// NFKC 规范化：将兼容性字符（如康熙部首 ⾳ U+2FB3）统一为标准字符（音 U+97F3）
	// 网易云部分歌词数据使用兼容性变体，导致关键词匹配失败
	const normalized = text.normalize("NFKC");
	const trimmed = normalized.trim();

	if (trimmed.length === 0) return false;

	// 提取冒号前的部分作为"标签"，检查标签中是否包含元数据关键词
	// 这样 "混音师:" 包含关键词 "混音"，"母带后期制作人:" 包含关键词 "母带后期" 或 "制作人"
	// 安全约束：短关键词（≤2字）只做精确匹配，避免 "词汇:" "曲调:" 等正常歌词被误过滤
	const colonIndex = trimmed.search(/[:：]/);
	if (colonIndex > 0) {
		const label = trimmed.substring(0, colonIndex).trim();
		const labelLower = label.toLowerCase();
		for (const keyword of METADATA_KEYWORDS) {
			const kwLower = keyword.toLowerCase();
			if (keyword.length <= 1) {
				// 单字关键词精确匹配，防止 "词汇:" 被误判为含 "词"，"曲调:" 被误判为含 "曲"
				if (labelLower === kwLower) return true;
			} else {
				// 两字及以上关键词使用 includes 匹配
				// "作词"/"作曲"/"编曲" 等双字关键词足够特异，不会误伤正常歌词
				if (labelLower === kwLower || labelLower.includes(kwLower)) {
					return true;
				}
			}
		}
	} else {
		// 无冒号时，检查是否完全匹配关键词
		const trimmedLower = trimmed.toLowerCase();
		for (const keyword of METADATA_KEYWORDS) {
			if (trimmedLower === keyword.toLowerCase()) {
				return true;
			}
		}
	}

	// 检查复合格式如 "词/曲" 或 "作词/作曲"
	if (trimmed.includes("/") && (trimmed.includes("词") || trimmed.includes("曲"))) {
		const parts = trimmed.split(/[:：]/);
		if (parts.length > 0) {
			const header = parts[0].trim();
			if (header.includes("词") && header.includes("曲") && header.length <= 10) {
				return true;
			}
		}
	}

	// 额外检查：检查是否看起来像人名/艺人列表（通常包含多个斜杠或者逗号分隔的名字）
	// 但要排除正常的歌词内容 — 歌词中 "原文/翻译" 格式很常见
	if (trimmed.includes("/") && !trimmed.match(/\w+\/\w+/)) {
		const parts = trimmed.split("/");

		// 如果任意段包含假名（平假名/片假名），则很可能是日文歌词而非元数据
		const hasKana = parts.some((part) =>
			/[\u3040-\u309F\u30A0-\u30FF]/.test(part),
		);
		if (hasKana) return false;

		// 如果任意段超过10字符，则很可能是歌词行而非人名列表
		const hasLongPart = parts.some((part) => part.trim().length > 10);
		if (hasLongPart) return false;

		const hasOnlyNamesAndDelimiters = parts.every((part) => {
			const cleaned = part.trim();
			// 检查是否只包含汉字、字母或空格（排除假名，因为假名已在上面排除）
			return cleaned.match(/^[\u4E00-\u9FFFa-zA-Z0-9\s]+$/);
		});

		if (hasOnlyNamesAndDelimiters && parts.length >= 2) {
			return true;
		}
	}

	return false;
}

export function parseLrc(lrcStr: string, options?: { skipMetadataFilter?: boolean }): LrcLine[] {
	if (!lrcStr) return [];
	const lines = lrcStr.split("\n");
	const result: LrcLine[] = [];
	const regex =
		/\[(?<min>\d{2,3}):(?<sec>\d{2})(?:\.(?<ms>\d{2,3}))?\](?<text>.*)/;

	for (const line of lines) {
		const match = line.match(regex);
		if (match?.groups) {
			const { min, sec, ms, text } = match.groups;

			// 过滤元数据行（除非显式跳过）
			if (!options?.skipMetadataFilter && isMetadataLine(text)) {
				continue;
			}

			const minVal = parseInt(min, 10);
			const secVal = parseInt(sec, 10);
			let msVal = 0;
			if (ms) {
				msVal = parseInt(ms, 10);
				if (ms.length === 2) msVal *= 10;
			}

			const time = minVal * 60000 + secVal * 1000 + msVal;

			result.push({ time, text });
		}
	}
	return result;
}
