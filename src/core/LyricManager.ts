import type {
	BaseLyricAdapter,
	LyricAdapterEventMap,
} from "@/adapters/BaseLyricAdapter";
import type { LyricSearchStatus, RawLyricData } from "@/store";
import type { SongInfo } from "@/types/inflink";
import type { AmllLyricContent } from "@/types/ws";
import { TypedEventTarget } from "@/utils/TypedEventTarget";

export class LyricManager extends TypedEventTarget<LyricAdapterEventMap> {
	private adapters: BaseLyricAdapter[] = [];
	private caches: Map<string, AmllLyricContent | null> = new Map();
	private rawLyricDataCache: Record<string, RawLyricData | null> = {};

	private currentMusicId: string | number | null = null;
	private statuses: Record<string, LyricSearchStatus> = {};

	private isDebouncing = false;
	private debounceTimer: ReturnType<typeof setTimeout> | null = null;
	private DEBOUNCE_DELAY_MS = 1000;

	public async init(): Promise<void> {
		await Promise.all(this.adapters.map((a) => a.init()));
	}

	public destroy(): void {
		for (const adapter of this.adapters) {
			adapter.removeEventListener("update", this.handleAdapterUpdate);
			adapter.removeEventListener("rawlyric", this.handleAdapterRawLyricData);
			adapter.destroy();
		}
		this.adapters = [];
		this.caches.clear();
		this.rawLyricDataCache = {};
	}

	public setAdapters(adapters: BaseLyricAdapter[]) {
		for (const adapter of this.adapters) {
			adapter.removeEventListener("update", this.handleAdapterUpdate);
			adapter.removeEventListener("rawlyric", this.handleAdapterRawLyricData);
		}

		this.adapters = adapters;
		this.caches.clear();
		this.rawLyricDataCache = {};

		for (const adapter of this.adapters) {
			adapter.addEventListener("update", this.handleAdapterUpdate);
			adapter.addEventListener("rawlyric", this.handleAdapterRawLyricData);
		}
	}

	public fetchLyric(songInfo: SongInfo): void {
		console.log("[LyricManager] fetchLyric:", `ncmId=${songInfo.ncmId}`, `adapters=${this.adapters.map((a) => a.id).join(", ")}`);

		if (this.currentMusicId !== songInfo.ncmId) {
			this.currentMusicId = songInfo.ncmId;
			// 只清除缓存，不立即发送 null（避免切歌时封面闪烁）
			// 如果新歌确实无歌词，adapter 会返回 null 并触发封面
			this.caches.clear();
			this.rawLyricDataCache = {};
		}

		this.statuses = {};
		for (const adapter of this.adapters) {
			this.statuses[adapter.id] = "searching";
		}
		this.dispatch("statuschange", { ...this.statuses });

		this.clearDebounceTimer();

		this.isDebouncing = true;
		this.debounceTimer = setTimeout(() => {
			this.clearDebounceTimer();
			this.evaluateAndDispatch();
		}, this.DEBOUNCE_DELAY_MS);

		for (const adapter of this.adapters) {
			adapter.fetchLyric(songInfo);
		}
	}

	private handleAdapterUpdate = (
		event: CustomEvent<AmllLyricContent | null>,
	) => {
		const adapter = event.currentTarget as BaseLyricAdapter;
		const lyric = event.detail;

		console.log(
			"[LyricManager] 收到 adapter 更新:",
			`id=${adapter.id}`,
			`有歌词=${!!lyric}`,
			`lyric格式=${lyric?.format ?? "null"}`,
			`行数=${lyric?.format === "structured" ? lyric.lines.length : "n/a"}`,
		);

		this.caches.set(adapter.id, lyric);

		if (lyric) {
			this.statuses[adapter.id] = "found";
		} else {
			this.statuses[adapter.id] = "not_found";
		}

		this.evaluateAndDispatch();
	};

	private handleAdapterRawLyricData = (
		event: CustomEvent<RawLyricData | null>,
	) => {
		const adapter = event.currentTarget as BaseLyricAdapter;
		this.rawLyricDataCache[adapter.id] = event.detail;
		this.dispatch("rawlyricchange", { ...this.rawLyricDataCache });
	};

	private evaluateAndDispatch() {
		let hasFoundHigherPriority = false;
		let finalLyric: AmllLyricContent | null = null;
		let isWaitingForHigherPriority = false;

		for (const adapter of this.adapters) {
			if (hasFoundHigherPriority) {
				if (this.statuses[adapter.id] === "searching") {
					this.statuses[adapter.id] = "skipped";
				}
				continue;
			}

			const status = this.statuses[adapter.id];

			if (status === "found") {
				hasFoundHigherPriority = true;
				finalLyric = this.caches.get(adapter.id) || null;
			} else if (status === "searching") {
				if (this.isDebouncing) {
					isWaitingForHigherPriority = true;
					break;
				}
			}
		}

		console.log(
			"[LyricManager] evaluateAndDispatch:",
			`statuses=${JSON.stringify(this.statuses)}`,
			`isDebouncing=${this.isDebouncing}`,
			`hasFoundHigherPriority=${hasFoundHigherPriority}`,
			`isWaitingForHigherPriority=${isWaitingForHigherPriority}`,
			`finalLyric=${finalLyric ? `${finalLyric.format}` : "null"}`,
		);

		this.dispatch("statuschange", { ...this.statuses });

		if (isWaitingForHigherPriority) {
			return;
		}

		this.dispatch("update", finalLyric);

		if (hasFoundHigherPriority && this.isDebouncing) {
			this.clearDebounceTimer();
		}
	}

	private clearDebounceTimer() {
		this.isDebouncing = false;
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}
	}
}
