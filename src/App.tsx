/**
 * @fileoverview
 * 插件设置界面根组件
 */

import createCache from "@emotion/cache";
import { CacheProvider } from "@emotion/react";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import BugReportIcon from "@mui/icons-material/BugReport";
import FormatListNumberedIcon from "@mui/icons-material/FormatListNumbered";
import LinkIcon from "@mui/icons-material/Link";
import PowerSettingsNewIcon from "@mui/icons-material/PowerSettingsNew";
import SyncIcon from "@mui/icons-material/Sync";
import WifiIcon from "@mui/icons-material/Wifi";
import {
	Alert,
	Box,
	Button,
	CircularProgress,
	Collapse,
	InputAdornment,
	Switch,
	TextField,
	Typography,
} from "@mui/material";
import { createTheme, ThemeProvider } from "@mui/material/styles";
import { Provider, useAtom, useAtomValue } from "jotai";
import { useEffect, useMemo, useState } from "react";
import { AmllWsClient } from "./components/headless/AmllWsClient";
import { InfLinkBridge } from "./components/headless/InfLinkBridge";
import { LyricSync } from "./components/headless/LyricSync";
import { DebugDialog } from "./components/ui/DebugDialog";
import { LyricSourcesDialog } from "./components/ui/LyricSourcesDialog";
import { SettingItem } from "./components/ui/SettingItem";
import { useNcmTheme } from "./hooks/useNcmTheme";
import {
	autoConnectAtom,
	autoReconnectAtom,
	type ConnectionStatus,
	connectionErrorAtom,
	connectionStatusAtom,
	infLinkStatusAtom,
	timelineOffsetAtom,
	wsUrlAtom,
} from "./store";

const STATUS_LABEL: Record<ConnectionStatus, string> = {
	connected: "已连接",
	connecting: "连接中...",
	disconnected: "未连接",
	error: "错误",
};

const STATUS_TEXT_COLOR: Record<ConnectionStatus, string> = {
	connected: "success.main",
	connecting: "info.main",
	disconnected: "text.secondary",
	error: "error.main",
};

const amllEmotionCache = createCache({
	key: "amll-ws-connector",
});

export default function App() {
	const ncmThemeMode = useNcmTheme();

	const theme = useMemo(
		() =>
			createTheme({
				palette: {
					mode: ncmThemeMode,
					primary: {
						main: "#F25774",
					},
				},
				typography: {
					fontFamily: [
						'"Noto Sans SC"',
						'"Microsoft YaHei"',
						'"Segoe UI"',
						"Roboto",
						'"Helvetica Neue"',
						"Arial",
						"sans-serif",
					].join(","),
				},
			}),
		[ncmThemeMode],
	);

	return (
		<CacheProvider value={amllEmotionCache}>
			<ThemeProvider theme={theme}>
				<Provider>
					<InfLinkBridge />
					<AmllWsClient />
					<LyricSync />
					<Main />
				</Provider>
			</ThemeProvider>
		</CacheProvider>
	);
}

function Main() {
	const [wsUrl, setWsUrl] = useAtom(wsUrlAtom);
	const [autoConnect, setAutoConnect] = useAtom(autoConnectAtom);
	const [autoReconnect, setAutoReconnect] = useAtom(autoReconnectAtom);
	const [status, setStatus] = useAtom(connectionStatusAtom);
	const [error, setError] = useAtom(connectionErrorAtom);
	const [displayError, setDisplayError] = useState(error);
	const [debugOpen, setDebugOpen] = useState(false);
	const [sourcesDialogOpen, setSourcesDialogOpen] = useState(false);
	const [timelineOffset, setTimelineOffset] = useAtom(timelineOffsetAtom);
	const [localOffset, setLocalOffset] = useState(timelineOffset.toString());

	const infLinkStatus = useAtomValue(infLinkStatusAtom);

	const isConnected = status === "connected";
	const isConnecting = status === "connecting";

	function handleToggleConnection() {
		if (isConnected || isConnecting) {
			setStatus("disconnected");
			setError("");
		} else {
			setStatus("connecting");
			setError("");
		}
	}

	useEffect(() => {
		if (error) {
			setDisplayError(error);
		}
	}, [error]);

	useEffect(() => {
		setLocalOffset(timelineOffset.toString());
	}, [timelineOffset]);

	const handleOffsetCommit = () => {
		const parsed = parseInt(localOffset, 10);
		if (!Number.isNaN(parsed)) {
			setTimelineOffset(parsed);
		} else {
			setLocalOffset(timelineOffset.toString());
		}
	};

	const alertConfig = {
		waiting: {
			severity: "info" as const,
			icon: <CircularProgress size={20} color="inherit" />,
			message: "正在等待 InfLink-rs 插件加载...",
		},
		error: {
			severity: "error" as const,
			icon: undefined,
			message:
				"等待 InfLink-rs 插件超时，请确保你已经安装了此插件。本插件需要 InfLink-rs 插件才能运行",
		},
		outdated: {
			severity: "warning" as const,
			icon: undefined,
			message: "InfLink-rs 插件版本过低，建议更新至 3.2.11 或以上版本",
		},
		ready: {
			severity: "success" as const,
			icon: undefined,
			message: "InfLink-rs 已加载",
		},
	};
	const currentAlert = alertConfig[infLinkStatus];

	return (
		<Box sx={{ pb: 4, pt: 1 }}>
			<Typography variant="h5" sx={{ mb: 3, fontWeight: "bold" }}>
				AMLL WS Connector 设置
			</Typography>

			<Collapse in={infLinkStatus !== "ready"}>
				<Alert
					severity={currentAlert.severity}
					icon={currentAlert.icon}
					sx={{ mb: 3, borderRadius: 2, alignItems: "center" }}
				>
					{currentAlert.message}
				</Alert>
			</Collapse>

			<Collapse in={!!error}>
				<Alert
					severity="error"
					onClose={() => setError("")}
					sx={{ mb: 3, borderRadius: 2 }}
				>
					{displayError}
				</Alert>
			</Collapse>

			<SettingItem
				icon={<WifiIcon />}
				title="连接状态"
				description={
					<Box
						component="span"
						sx={{ color: STATUS_TEXT_COLOR[status], fontWeight: 500 }}
					>
						{STATUS_LABEL[status]}
					</Box>
				}
				action={
					<Box sx={{ position: "relative", display: "inline-flex" }}>
						<Button
							variant="outlined"
							size="small"
							color={isConnected || isConnecting ? "error" : "primary"}
							disabled={isConnecting}
							onClick={handleToggleConnection}
						>
							{isConnected || isConnecting ? "断开" : "连接"}
						</Button>

						{isConnecting && (
							<CircularProgress
								size={24}
								sx={{
									color: "primary.main",
									position: "absolute",
									top: "50%",
									left: "50%",
									marginTop: "-12px",
									marginLeft: "-12px",
								}}
							/>
						)}
					</Box>
				}
			/>

			<SettingItem
				icon={<LinkIcon />}
				title="WebSocket 服务器地址"
				description="AMLL Player 监听的 WebSocket 服务器地址"
				action={
					<TextField
						size="small"
						value={wsUrl}
						onChange={(e) => setWsUrl(e.target.value)}
						placeholder="ws://localhost:11444"
						disabled={isConnected || isConnecting}
						sx={{ width: 220 }}
					/>
				}
			/>

			<SettingItem
				icon={<PowerSettingsNewIcon />}
				title="自动连接"
				description="插件加载时自动连接到配置的 WebSocket 服务器"
				action={
					<Switch
						checked={autoConnect}
						onChange={(_, checked) => setAutoConnect(checked)}
					/>
				}
			/>

			<SettingItem
				icon={<SyncIcon />}
				title="断开自动重连"
				description="连接断开后自动尝试重新连接（每3秒重试）"
				action={
					<Switch
						checked={autoReconnect}
						onChange={(_, checked) => setAutoReconnect(checked)}
					/>
				}
			/>

			<SettingItem
				icon={<AccessTimeIcon />}
				title="播放进度偏移量"
				description="正数表示延迟，负数表示提前"
				action={
					<TextField
						type="number"
						size="small"
						value={localOffset}
						onChange={(e) => setLocalOffset(e.target.value)}
						onBlur={handleOffsetCommit}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								e.preventDefault();
								(e.target as HTMLInputElement).blur();
							}
						}}
						sx={{ width: 140 }}
						slotProps={{
							input: {
								endAdornment: (
									<InputAdornment position="end">ms</InputAdornment>
								),
							},
						}}
					/>
				}
			/>

			<SettingItem
				icon={<FormatListNumberedIcon />}
				title="歌词源"
				description="管理获取歌词的来源"
				action={
					<Button
						variant="outlined"
						size="small"
						onClick={() => setSourcesDialogOpen(true)}
					>
						配置
					</Button>
				}
			/>

			<SettingItem
				icon={<BugReportIcon />}
				title="调试面板"
				description="查看获取到的歌曲状态"
				action={
					<Button
						variant="outlined"
						size="small"
						onClick={() => setDebugOpen(true)}
					>
						打开
					</Button>
				}
			/>

			<DebugDialog open={debugOpen} onClose={() => setDebugOpen(false)} />
			<LyricSourcesDialog
				open={sourcesDialogOpen}
				onClose={() => setSourcesDialogOpen(false)}
			/>
		</Box>
	);
}
