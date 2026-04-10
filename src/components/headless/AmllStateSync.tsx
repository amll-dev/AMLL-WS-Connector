/**
 * @fileoverview
 * 将歌曲信息同步给 AMLL Player，同时处理 AMLL Player 的控制指令
 */

import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useRef } from "react";
import { useWsConnectionManager } from "@/hooks/useWsConnectionManager";
import {
	autoConnectAtom,
	connectionIntentAtom,
	connectionStatusAtom,
	lyricAtom,
	lyricSearchStatusAtom,
	nextAtom,
	pauseAtom,
	playAtom,
	playbackStatusAtom,
	playModeAtom,
	previousAtom,
	reconnectCountdownAtom,
	seekToAtom,
	setRepeatModeAtom,
	setShuffleModeAtom,
	setVolumeAtom,
	songInfoAtom,
	timelineInfoAtom,
	timelineOffsetAtom,
	volumeInfoAtom,
} from "@/store";
import type {
	AudioDataInfo,
	RepeatMode as NCMRepeatMode,
} from "@/types/inflink";
import type { AmllMessage, AmllRepeatMode, AmllStateUpdate } from "@/types/ws";
import { CoverManager } from "@/utils/cover";
import {
	BinaryMagicNumber,
	createAmllBinaryPayload,
} from "@/utils/createAmllBinaryPayload";
import { AudioDataBus } from "./InfLinkBridge";

export function AmllStateSync() {
	const status = useAtomValue(connectionStatusAtom);
	const autoConnect = useAtomValue(autoConnectAtom);
	const setIntent = useSetAtom(connectionIntentAtom);
	const isInitializedRef = useRef(false);

	const coverManagerRef = useRef(new CoverManager());

	const songInfo = useAtomValue(songInfoAtom);
	const playbackStatus = useAtomValue(playbackStatusAtom);
	const timelineInfo = useAtomValue(timelineInfoAtom);
	const playMode = useAtomValue(playModeAtom);
	const volumeInfo = useAtomValue(volumeInfoAtom);
	const timelineOffset = useAtomValue(timelineOffsetAtom);

	const lyricContent = useAtomValue(lyricAtom);
	const lyricSearchStatus = useAtomValue(lyricSearchStatusAtom);

	const play = useSetAtom(playAtom);
	const pause = useSetAtom(pauseAtom);
	const next = useSetAtom(nextAtom);
	const previous = useSetAtom(previousAtom);
	const setVolume = useSetAtom(setVolumeAtom);
	const seekTo = useSetAtom(seekToAtom);
	const setRepeatMode = useSetAtom(setRepeatModeAtom);
	const setShuffleMode = useSetAtom(setShuffleModeAtom);

	const setReconnectCountdown = useSetAtom(reconnectCountdownAtom);

	const lastSentSongIdRef = useRef<number | null>(null);
	const lyricTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const handleIncomingMessage = useCallback(
		(event: MessageEvent) => {
			if (typeof event.data !== "string") return;

			try {
				const message: AmllMessage = JSON.parse(event.data);

				if (message.type === "command") {
					const cmd = message.value;

					switch (cmd.command) {
						case "pause":
							pause();
							break;
						case "resume":
							play();
							break;
						case "forwardSong":
							next();
							break;
						case "backwardSong":
							previous();
							break;
						case "setVolume":
							setVolume(cmd.volume);
							break;
						case "seekPlayProgress":
							seekTo(cmd.progress);
							break;
						case "setRepeatMode": {
							const modeMap: Record<AmllRepeatMode, NCMRepeatMode> = {
								off: "None",
								all: "List",
								one: "Track",
							};
							setRepeatMode(modeMap[cmd.mode]);
							break;
						}
						case "setShuffleMode":
							setShuffleMode(cmd.enabled);
							break;
						default: {
							const exhaustiveCheck: never = cmd;
							console.warn("未处理的控制指令", exhaustiveCheck);
						}
					}
				}
			} catch (err) {
				console.error("解析 AMLL WebSocket 消息失败:", err);
			}
		},
		[
			play,
			pause,
			next,
			previous,
			setVolume,
			seekTo,
			setRepeatMode,
			setShuffleMode,
		],
	);

	useEffect(() => {
		if (!isInitializedRef.current) {
			setIntent(autoConnect);
			isInitializedRef.current = true;
		}
	}, [autoConnect, setIntent]);

	const { send, countdown } = useWsConnectionManager({
		onMessage: handleIncomingMessage,
		onConnected: () => {
			send(JSON.stringify({ type: "initialize" }));
		},
	});

	useEffect(() => {
		setReconnectCountdown(countdown);
	}, [countdown, setReconnectCountdown]);

	const sendStateUpdate = useCallback(
		(updateObj: AmllStateUpdate) => {
			send(JSON.stringify({ type: "state", value: updateObj }));
		},
		[send],
	);

	useEffect(() => {
		if (!songInfo || status !== "connected") return;

		sendStateUpdate({
			update: "setMusic",
			musicId: songInfo.ncmId.toString(),
			musicName: songInfo.songName,
			albumId: "",
			albumName: songInfo.albumName,
			artists: [{ id: "", name: songInfo.authorName }],
			duration: songInfo.duration ?? 0,
		});

		if (songInfo.cover?.url) {
			const fetchAndSendCover = async () => {
				try {
					const { cover } = await coverManagerRef.current.getCover(
						songInfo,
						"500",
					);

					if (cover?.blob) {
						const arrayBuffer = await cover.blob.arrayBuffer();

						const buffer = createAmllBinaryPayload(
							BinaryMagicNumber.SetCoverData,
							arrayBuffer,
						);

						send(buffer);
					}
				} catch (e) {
					if ((e as Error).name !== "AbortError") {
						console.error("获取或发送缓存封面失败", e);
						sendStateUpdate({
							update: "setCover",
							source: "uri",
							url: songInfo.cover?.url || "",
						});
					}
				}
			};

			fetchAndSendCover();
		}
	}, [songInfo, status, send, sendStateUpdate]);

	useEffect(() => {
		if (!playbackStatus || status !== "connected") return;
		sendStateUpdate({
			update: playbackStatus === "Playing" ? "resumed" : "paused",
		});
	}, [playbackStatus, status, sendStateUpdate]);

	useEffect(() => {
		if (!timelineInfo || status !== "connected") return;

		const adjustedProgress = Math.max(
			0,
			timelineInfo.currentTime - timelineOffset,
		);

		sendStateUpdate({
			update: "progress",
			progress: Math.floor(adjustedProgress),
		});
	}, [timelineInfo, timelineOffset, status, sendStateUpdate]);

	useEffect(() => {
		if (!volumeInfo || status !== "connected") return;
		sendStateUpdate({
			update: "volume",
			volume: volumeInfo.isMuted ? 0 : volumeInfo.volume,
		});
	}, [volumeInfo, status, sendStateUpdate]);

	useEffect(() => {
		if (!playMode || status !== "connected") return;
		const repeatMap: Record<NCMRepeatMode, AmllRepeatMode> = {
			None: "off",
			Track: "one",
			List: "all",
			AI: "all",
		};
		sendStateUpdate({
			update: "modeChanged",
			repeat: repeatMap[playMode.repeatMode] || "off",
			shuffle: playMode.isShuffling,
		});
	}, [playMode, status, sendStateUpdate]);

	useEffect(() => {
		if (status !== "connected") return;

		const currentSongId = songInfo?.ncmId ?? null;

		if (!lyricContent) {
			const sendEmptyLyric = () => {
				console.log(
					"[AmllStateSync] 发送空歌词（封面模式）",
					`songId=${currentSongId}`,
				);
				sendStateUpdate({
					update: "setLyric",
					format: "structured",
					lines: [],
				});
				lastSentSongIdRef.current = currentSongId;
			};

			if (lastSentSongIdRef.current === currentSongId) {
				clearTimeout(lyricTimeoutRef.current ?? undefined);
				lyricTimeoutRef.current = null;
				sendEmptyLyric();
			} else {
				const statuses = Object.values(lyricSearchStatus);
				const hasStatuses = statuses.length > 0;
				const allDone = statuses.every(
					(s) => s === "found" || s === "not_found" || s === "skipped",
				);

				if (hasStatuses && allDone) {
					clearTimeout(lyricTimeoutRef.current ?? undefined);
					lyricTimeoutRef.current = null;
					sendEmptyLyric();
				} else if (!lyricTimeoutRef.current) {
					console.log(
						"[AmllStateSync] 启动超时定时器等待歌词搜索完成",
						`songId=${currentSongId}`,
					);
					lyricTimeoutRef.current = setTimeout(() => {
						console.warn(
							"[AmllStateSync] 歌词搜索超时（2s），强制发送空歌词兜底",
							`songId=${currentSongId}`,
						);
						sendEmptyLyric();
					}, 2000);
				}
			}
			return;
		}

		clearTimeout(lyricTimeoutRef.current ?? undefined);
		lyricTimeoutRef.current = null;

		lastSentSongIdRef.current = currentSongId;

		sendStateUpdate({
			update: "setLyric",
			...lyricContent,
		});
	}, [lyricContent, status, sendStateUpdate, lyricSearchStatus, songInfo?.ncmId]);

	useEffect(() => {
		const handleAudioData = (e: Event) => {
			if (status !== "connected") return;

			const { data } = (e as CustomEvent<AudioDataInfo>).detail;

			const buffer = createAmllBinaryPayload(BinaryMagicNumber.AudioData, data);

			send(buffer);
		};

		AudioDataBus.addEventListener("audiodata", handleAudioData);
		return () => {
			AudioDataBus.removeEventListener("audiodata", handleAudioData);
		};
	}, [send, status]);

	return null;
}
