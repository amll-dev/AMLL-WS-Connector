/**
 * @fileoverview
 * 将歌曲信息通过 Websocket 同步给 AMLL Player，同时处理 AMLL Player 的控制指令
 */

import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useRef } from "react";
import {
	autoConnectAtom,
	autoReconnectAtom,
	connectionErrorAtom,
	connectionStatusAtom,
	lyricAtom,
	nextAtom,
	pauseAtom,
	playAtom,
	playbackStatusAtom,
	playModeAtom,
	previousAtom,
	seekToAtom,
	setRepeatModeAtom,
	setShuffleModeAtom,
	setVolumeAtom,
	songInfoAtom,
	timelineInfoAtom,
	timelineOffsetAtom,
	volumeInfoAtom,
	wsUrlAtom,
} from "@/store";
import type {
	AudioDataInfo,
	RepeatMode as NCMRepeatMode,
} from "@/types/inflink";
import type { AmllMessage, AmllRepeatMode, AmllStateUpdate } from "@/types/ws";
import { CoverManager } from "@/utils/cover";
import { AudioDataBus } from "./InfLinkBridge";

export function AmllWsClient() {
	const wsRef = useRef<WebSocket | null>(null);
	const hasAutoConnected = useRef(false);
	const hasAttemptedConnect = useRef(false);
	const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const isManualDisconnect = useRef(false);
	const autoReconnectRef = useRef(false);
	const coverManagerRef = useRef(new CoverManager());

	const wsUrl = useAtomValue(wsUrlAtom);
	const autoConnect = useAtomValue(autoConnectAtom);
	const autoReconnect = useAtomValue(autoReconnectAtom);
	const [status, setStatus] = useAtom(connectionStatusAtom);
	const setError = useSetAtom(connectionErrorAtom);

	const songInfo = useAtomValue(songInfoAtom);
	const playbackStatus = useAtomValue(playbackStatusAtom);
	const timelineInfo = useAtomValue(timelineInfoAtom);
	const playMode = useAtomValue(playModeAtom);
	const volumeInfo = useAtomValue(volumeInfoAtom);
	const timelineOffset = useAtomValue(timelineOffsetAtom);

	const lyricContent = useAtomValue(lyricAtom);

	const play = useSetAtom(playAtom);
	const pause = useSetAtom(pauseAtom);
	const next = useSetAtom(nextAtom);
	const previous = useSetAtom(previousAtom);
	const setVolume = useSetAtom(setVolumeAtom);
	const seekTo = useSetAtom(seekToAtom);
	const setRepeatMode = useSetAtom(setRepeatModeAtom);
	const setShuffleMode = useSetAtom(setShuffleModeAtom);

	const clearReconnectTimer = useCallback(() => {
		if (reconnectTimerRef.current) {
			clearTimeout(reconnectTimerRef.current);
			reconnectTimerRef.current = null;
		}
	}, []);

	const scheduleReconnect = useCallback(() => {
		if (!autoReconnectRef.current || isManualDisconnect.current) return;

		clearReconnectTimer();

		reconnectTimerRef.current = setTimeout(() => {
			if (autoReconnectRef.current && !isManualDisconnect.current) {
				setStatus("connecting");
			}
		}, 3000);
	}, [setStatus, clearReconnectTimer]);

	useEffect(() => {
		autoReconnectRef.current = autoReconnect;

		if (!autoReconnect) {
			clearReconnectTimer();
		} else if (
			hasAttemptedConnect.current &&
			(status === "disconnected" || status === "error")
		) {
			if (!isManualDisconnect.current) {
				scheduleReconnect();
			}
		}
	}, [autoReconnect, status, clearReconnectTimer, scheduleReconnect]);

	useEffect(() => {
		if (!hasAutoConnected.current && autoConnect && status === "disconnected") {
			hasAutoConnected.current = true;
			isManualDisconnect.current = false;
			setStatus("connecting");
		}
	}, [autoConnect, status, setStatus]);

	const sendWs = useCallback((updateObj: AmllStateUpdate) => {
		if (wsRef.current?.readyState === WebSocket.OPEN) {
			wsRef.current.send(JSON.stringify({ type: "state", value: updateObj }));
		}
	}, []);

	useEffect(() => {
		if (status === "connecting" && !wsRef.current) {
			isManualDisconnect.current = false;
			hasAttemptedConnect.current = true;
			const ws = new WebSocket(wsUrl);
			wsRef.current = ws;

			ws.onopen = () => {
				clearReconnectTimer();
				setStatus("connected");
				setError("");
				ws.send(JSON.stringify({ type: "initialize" }));
			};

			ws.onmessage = (event) => {
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
			};

			ws.onclose = () => {
				if (wsRef.current === ws) {
					setStatus("disconnected");
					wsRef.current = null;
					scheduleReconnect();
				}
			};

			ws.onerror = () => {
				if (wsRef.current === ws) {
					setStatus("error");
					setError("无法连接到 AMLL Player，请检查地址是否正确");
					wsRef.current = null;
					scheduleReconnect();
				}
			};
		} else if (status === "disconnected" && wsRef.current) {
			isManualDisconnect.current = true;
			clearReconnectTimer();
			wsRef.current.close();
			wsRef.current = null;
		}
	}, [
		status,
		wsUrl,
		setStatus,
		setError,
		scheduleReconnect,
		clearReconnectTimer,
		play,
		pause,
		next,
		previous,
		setVolume,
		seekTo,
		setRepeatMode,
		setShuffleMode,
	]);

	useEffect(() => {
		return () => {
			clearReconnectTimer();
			if (wsRef.current) {
				wsRef.current.close();
				wsRef.current = null;
			}
		};
	}, [clearReconnectTimer]);

	useEffect(() => {
		if (!songInfo || status !== "connected") return;

		sendWs({
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

					if (cover?.blob && wsRef.current?.readyState === WebSocket.OPEN) {
						const arrayBuffer = await cover.blob.arrayBuffer();

						const buffer = createAmllBinaryPayload(
							BinaryMagicNumber.SetCoverData,
							arrayBuffer,
						);

						wsRef.current.send(buffer);
					}
				} catch (e) {
					if ((e as Error).name !== "AbortError") {
						console.error("获取或发送缓存封面失败", e);
						sendWs({
							update: "setCover",
							source: "uri",
							url: songInfo.cover?.url || "",
						});
					}
				}
			};

			fetchAndSendCover();
		}
	}, [songInfo, status, sendWs]);

	useEffect(() => {
		if (!playbackStatus || status !== "connected") return;
		sendWs({
			update: playbackStatus === "Playing" ? "resumed" : "paused",
		});
	}, [playbackStatus, status, sendWs]);

	useEffect(() => {
		if (!timelineInfo || status !== "connected") return;

		const adjustedProgress = Math.max(
			0,
			timelineInfo.currentTime - timelineOffset,
		);

		sendWs({
			update: "progress",
			progress: Math.floor(adjustedProgress),
		});
	}, [timelineInfo, timelineOffset, status, sendWs]);

	useEffect(() => {
		if (!volumeInfo || status !== "connected") return;
		sendWs({
			update: "volume",
			volume: volumeInfo.isMuted ? 0 : volumeInfo.volume,
		});
	}, [volumeInfo, status, sendWs]);

	useEffect(() => {
		if (!playMode || status !== "connected") return;
		const repeatMap: Record<NCMRepeatMode, AmllRepeatMode> = {
			None: "off",
			Track: "one",
			List: "all",
			AI: "all",
		};
		sendWs({
			update: "modeChanged",
			repeat: repeatMap[playMode.repeatMode] || "off",
			shuffle: playMode.isShuffling,
		});
	}, [playMode, status, sendWs]);

	useEffect(() => {
		if (!lyricContent || status !== "connected") return;

		sendWs({
			update: "setLyric",
			...lyricContent,
		});
	}, [lyricContent, status, sendWs]);

	useEffect(() => {
		const handleAudioData = (e: Event) => {
			const ws = wsRef.current;
			if (ws?.readyState !== WebSocket.OPEN) return;

			const { data } = (e as CustomEvent<AudioDataInfo>).detail;

			const buffer = createAmllBinaryPayload(BinaryMagicNumber.AudioData, data);

			ws.send(buffer);
		};

		AudioDataBus.addEventListener("audiodata", handleAudioData);
		return () => {
			AudioDataBus.removeEventListener("audiodata", handleAudioData);
		};
	}, []);

	return null;
}

export enum BinaryMagicNumber {
	AudioData = 0,
	SetCoverData = 1,
}

export function createAmllBinaryPayload(
	magicNumber: BinaryMagicNumber,
	payload: ArrayBuffer,
): ArrayBuffer {
	const HEADER_SIZE = 6;
	const buffer = new ArrayBuffer(HEADER_SIZE + payload.byteLength);
	const view = new DataView(buffer);

	view.setUint16(0, magicNumber, true);
	view.setUint32(2, payload.byteLength, true);
	new Uint8Array(buffer, HEADER_SIZE).set(new Uint8Array(payload));

	return buffer;
}
