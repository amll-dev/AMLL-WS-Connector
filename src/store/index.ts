/**
 * @fileoverview
 * 插件的全局状态定义
 */

import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import type {
	PlaybackStatus,
	PlayMode,
	SongInfo,
	TimelineInfo,
	VolumeInfo,
} from "@/types/inflink";
import type { AmllLyricContent } from "@/types/ws";
import {
	LYRIC_SOURCE_UUID_BUILTIN_AMLL_TTML_DB,
	LYRIC_SOURCE_UUID_BUILTIN_NCM,
	LyricFormat,
	type LyricSource,
} from "@/utils/source";

export * from "./api";

export interface ConfiguredLyricSource {
	source: LyricSource;
	enabled: boolean;
}

export type LyricSearchStatus =
	| "idle"
	| "searching"
	| "found"
	| "not_found"
	| "skipped";

/** WebSocket 服务器地址 */
export const wsUrlAtom = atomWithStorage(
	"amll-ws-connector:wsUrl",
	"ws://localhost:11444",
);

/** 是否在插件加载时自动连接 */
export const autoConnectAtom = atomWithStorage(
	"amll-ws-connector:autoConnect",
	false,
);

/** 是否在连接断开后自动重连 */
export const autoReconnectAtom = atomWithStorage(
	"amll-ws-connector:autoReconnect",
	true,
);

/** WebSocket 连接状态 */
export type ConnectionStatus =
	| "disconnected"
	| "connecting"
	| "connected"
	| "error";

export const connectionStatusAtom = atom<ConnectionStatus>("disconnected");

/** 最近一次连接错误信息 */
export const connectionErrorAtom = atom<string>("");

export type InfLinkStatus = "waiting" | "ready" | "error" | "outdated";

/** InfLink-rs API 的状态 */
export const infLinkStatusAtom = atom<InfLinkStatus>("waiting");

/** 当前歌曲信息 */
export const songInfoAtom = atom<SongInfo | null>(null);

/** 当前播放状态 */
export const playbackStatusAtom = atom<PlaybackStatus | null>(null);

/** 当前播放进度 */
export const timelineInfoAtom = atom<TimelineInfo | null>(null);

/** 当前播放模式 */
export const playModeAtom = atom<PlayMode | null>(null);

/** 当前音量信息 */
export const volumeInfoAtom = atom<VolumeInfo | null>(null);

/** 当前的歌词信息 */
export const lyricAtom = atom<AmllLyricContent | null>(null);

/**
 * 默认的歌词源配置
 */
const defaultSources: ConfiguredLyricSource[] = [
	{
		enabled: true,
		source: {
			type: "builtin:amll-ttml-db",
			id: LYRIC_SOURCE_UUID_BUILTIN_AMLL_TTML_DB,
			url: "https://raw.githubusercontent.com/amll-dev/amll-ttml-db/main/ncm-lyrics/[NCM_ID].ttml",
			format: LyricFormat.TTML,
			name: "AMLL TTML DB",
		},
	},
	{
		enabled: true,
		source: {
			type: "builtin:ncm",
			id: LYRIC_SOURCE_UUID_BUILTIN_NCM,
			url: "",
			format: LyricFormat.YRC,
			name: "网易云音乐歌词源",
		},
	},
];

/**
 * 歌词源配置
 */
export const lyricSourcesConfigAtom = atomWithStorage<ConfiguredLyricSource[]>(
	"amll-ws-connector:lyricSources",
	defaultSources,
);

/**
 * 每个歌词源当前的搜索状态
 *
 * Key 为歌词源的 id，Value 为搜索状态
 */
export const lyricSearchStatusAtom = atom<Record<string, LyricSearchStatus>>(
	{},
);

/**
 * 播放进度偏移量（毫秒）
 *
 * 正数表示延迟，负数表示提前
 */
export const timelineOffsetAtom = atomWithStorage<number>(
	"amll-ws-connector:timelineOffset",
	0,
);

export interface RawLyricData {
	main: string;
	trans?: string;
	roma?: string;
}

/**
 * 每个歌词源获取到的原始歌词数据
 */
export const rawLyricsContentAtom = atom<Record<string, RawLyricData | null>>(
	{},
);
