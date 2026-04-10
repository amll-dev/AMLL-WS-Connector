import type { AmllLyricLine } from "@/types/ws";

/**
 * 检测歌词是否为非滚动歌词（纯文本/元数据类型）
 *
 * 判定条件（满足任一即判定为非滚动）:
 * 1. 所有非空行的时间戳均为 0（典型的元数据歌词）
 * 2. 所有行的时间戳呈严格等差数列且差值为固定值（网易云给非滚动歌词分配的伪时间戳）
 * 3. 所有行的 startTime 都相同且 startTime === endTime（无播放持续时间）
 * 4. 所有行都超出合理范围（总长度 > 24小时）
 */
export function isNonScrollingLyric(lines: AmllLyricLine[]): boolean {
	if (!lines || lines.length === 0) return false;

	const nonEmptyLines = lines.filter((line) => {
		const text = line.words.map((w) => w.word).join("").trim();
		return text.length > 0;
	});

	if (nonEmptyLines.length === 0) return false;

	// 条件1: 所有行 startTime=0 且 endTime=0
	const allZeroTime = nonEmptyLines.every(
		(line) => line.startTime === 0 && line.endTime === 0,
	);

	if (allZeroTime) {
		console.log(
			"[lyricDetector] 全零时间戳 → 非滚动歌词:",
			`总行数=${lines.length}, 非空行=${nonEmptyLines.length}`,
			`前3行内容=${nonEmptyLines.slice(0, 3).map((l) => l.words.map((w) => w.word).join("")).join(" | ")}`,
		);
		return true;
	}

	// 条件2: 所有行的 endTime - startTime 为同一固定值（伪时间戳特征）
	// 非滚动歌词通常被分配 startTime=[0,1000,2000,...], endTime=[1000,2000,...]
	// 同时要求 startTime 呈等差数列（0, 1000, 2000, ...），以避免误判正常的短歌词
	if (nonEmptyLines.length >= 3) {
		const durations = nonEmptyLines.map(
			(line) => (line.endTime || 0) - (line.startTime || 0),
		);
		const firstDuration = durations[0];
		const allSameDuration = firstDuration > 0 && durations.every((d) => d === firstDuration);

		if (allSameDuration) {
			// 进一步检查 startTime 是否呈等差数列（非滚动歌词的典型特征）
			const startTimes = nonEmptyLines.map((l) => l.startTime);
			const intervals = startTimes.slice(1).map((t, i) => t - startTimes[i]);
			const allSameInterval = intervals.length > 0 && intervals.every((iv) => iv === intervals[0]);

			if (allSameInterval) {
				console.log(
					"[lyricDetector] 固定持续时间+等差时间戳 → 非滚动歌词:",
					`duration=${firstDuration}ms`,
					`interval=${intervals[0]}ms`,
					`行数=${nonEmptyLines.length}`,
					`前3行内容=${nonEmptyLines.slice(0, 3).map((l) => l.words.map((w) => w.word).join("")).join(" | ")}`,
				);
				return true;
			}
		}
	}

	// 条件3: 所有行的 startTime 都相同且 startTime === endTime（无持续时间）
	const firstStartTime = nonEmptyLines[0].startTime;
	const allSameStart = nonEmptyLines.every((line) => line.startTime === firstStartTime);
	const allNoDisplay = nonEmptyLines.every((line) => line.startTime === line.endTime);

	if (allSameStart && allNoDisplay) {
		console.log(
			"[lyricDetector] 所有行同一时刻无持续时间 → 非滚动歌词:",
			`startTime=${firstStartTime}ms`,
			`行数=${nonEmptyLines.length}`,
			`前3行内容=${nonEmptyLines.slice(0, 3).map((l) => l.words.map((w) => w.word).join("")).join(" | ")}`,
		);
		return true;
	}

	// 条件4: 检查是否所有行都在合理的时间范围内（< 24小时）
	// 如果最后一行的时间戳非常大（超过24小时），可能是无效时间戳
	const maxTime = Math.max(
		...nonEmptyLines.map((l) => Math.max(l.startTime, l.endTime)),
	);

	// 24小时 = 86400000ms，如果超过，可能是无效数据
	if (maxTime > 86400000) {
		console.log(
			"[lyricDetector] 时间戳超出24小时范围（无效数据）→ 非滚动歌词:",
			`maxTime=${maxTime}ms`,
			`行数=${nonEmptyLines.length}`,
		);
		return true;
	}

	return false;
}
