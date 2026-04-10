import type { Dispatch, Store } from "redux";

// --- 通用类型 ---
export interface Artist {
	id: string | undefined | null;
	name: string;
}

export namespace v3 {
	export interface ReduxState {
		"async:lyric": NcmAsyncLyricState;
	}

	export type NcmV3Action = {
		type: "async:lyric/fetchLyric";
		payload: { force: boolean };
	};

	export type NCMStore = Store<ReduxState, NcmV3Action>;

	export interface DvaTool {
		inited: boolean;
		app: DvaApp | null;
		getStore(): ReduxState;
		getDispatch(): Dispatch<NcmV3Action>;
	}

	type DvaApp = {
		_store: v3.NCMStore;
	};

	export interface DvaToolModule {
		a: DvaTool;
	}

	/**
	 * 网易云基础的行歌词格式
	 */
	export interface NcmLyricLine {
		/** 歌词对应的时间，单位为毫秒 */
		time: number;
		/** 歌词文本 */
		lyric: string;
	}

	/**
	 * 网易云逐字歌词 (YRC) 信息
	 */
	export interface NcmYrcInfo {
		/** 原始 YRC 字符串 */
		yrc: string;
		/** YRC 罗马音字符串 */
		yrcRoma: string;
		/** YRC 翻译字符串 */
		yrcTrans: string;
	}

	/**
	 * 歌词贡献者信息
	 */
	export interface NcmTranslationContributor {
		id: string;
		status: number;
		demand: number;
		userid: string;
		nickname: string;
		uptime: number;
	}

	/**
	 * 网易云 Redux Store 中 `async:lyric` 的完整状态树
	 */
	export interface NcmAsyncLyricState {
		isLoading: boolean;
		lyricLines: NcmLyricLine[];
		currentUsedLyric: string;
		currentUsedLyricVersion: number;
		displayType: string;
		romaLyricLines: NcmLyricLine[];
		tlyricLines: NcmLyricLine[];
		translationEnable: boolean;
		romaEnable: boolean;
		isLyricFetchFailed: boolean;
		askForTranslation: boolean;
		canUploadLyric: boolean;
		canUploadTranslation: boolean;
		offset: number;
		scrollable: boolean;
		yrcInfo?: NcmYrcInfo;
		translationContributor?: NcmTranslationContributor;
		isCloudLyric: boolean;
	}
}

/**
 * v2 客户端的类型空间
 *
 * 注意这些类型都是从网易云音乐PC客户端版本 2.10.13 获取的
 *
 * 特别是混淆后的名称几乎肯定会随着版本而变化
 */
export namespace v2 {
	export interface LrcLoadPayload {
		playid: string;
		lrctype: string;
		lrcid: number;
		checkUpdate: boolean;
		lrcdata: unknown;
		lyric: Lyric;
		type: string;
	}

	export interface Lyric {
		id: number;
		nolyric: boolean;
		uncollected: boolean;
		yrc: YrcData;
		roles: Role[];
		tlyric: SubLyricData;
		romalrc: SubLyricData;
		lrc: LyricData;
		qfy: boolean;
		sfy: boolean;
		sgc: boolean;
		lyricUser: User;
		transUser: User;
	}

	export interface Line {
		time: number;
		lyric: string;
	}

	export interface User {
		id: number;
		status: number;
		demand: number;
		userid: number;
		nickname: string;
		uptime: number;
	}

	export interface Role {
		roleName: string;
		originalRoleName: string;
		artistMetaList: ArtistMetaList[];
		sort: number;
		artistNames: string[];
	}

	export interface ArtistMetaList {
		artistId: number;
		artistName: string;
		picId: number | null;
		canJump: boolean;
	}

	export interface LyricData {
		copyFrom: boolean;
		id: number;
		lines: Line[];
		nolyric: boolean;
		offset: number;
		scrollable: number;
		source: string;
		uncollected: boolean;
		version: number;
	}

	export interface SubLyricData {
		version: number;
		lyric: string;
		lines: Line[];
		offset?: number;
	}

	export interface YrcData {
		lyric: string;
		version: string;
	}

	export interface LrcTimeUpdatePayload {
		result?: LyricData;
		tresult?: LyricData;
		lineno: number;
		lrc: string;
		tlrc?: string;
		rlrc?: string;
		time: number;
		trackId: string | number;
		type: string;
	}

	/**
	 * NEJ 事件总线对象
	 *
	 * 通过 `window.NEJ.P("nej.v")` 获取到的事件分发中心
	 * @see https://github.com/apoint123/nej/blob/39306b9a2c0f301bbb758e8e36f29f809137867b/src/base/event.js
	 */
	export interface NejEventBus {
		/**
		 * 派发/广播事件
		 * @see https://github.com/apoint123/nej/blob/39306b9a2c0f301bbb758e8e36f29f809137867b/src/base/event.js#L754-L762
		 * @note 原名 `_$dispatchEvent`
		 * @param element 触发事件的主体对象或节点，通常是某个播放器实例或全局对象
		 * @param type 事件类型，不区分大小写 (如 "lrctimeupdate", "lrcload")
		 * @param options 随事件广播的数据载荷
		 */
		Ge(element: string | Node, type: string, options: unknown): this;
	}

	/**
	 * NEJ 全局命名空间对象
	 * @see https://github.com/apoint123/nej/blob/39306b9a2c0f301bbb758e8e36f29f809137867b/src/base/global.js
	 */
	export interface NEJStatic {
		// 源码里就是单字母变量，这些没有被混淆，命名空间如 nej.v 也是
		O: Record<string, never>;
		R: never[];
		F: () => boolean;

		/**
		 * 命名空间声明与获取工厂
		 *
		 * 如果命名空间不存在则自动创建并返回该对象
		 * @param namespace 命名空间路径字符串 (如 'nej.v')
		 */
		P(namespace: "nej.v"): NejEventBus;
		P<T = unknown>(namespace: string): T;
	}

	/**
	 * AOP 拦截器触发时传入的事件对象封装
	 * @see https://github.com/apoint123/nej/blob/39306b9a2c0f301bbb758e8e36f29f809137867b/src/base/global.js#L310
	 */
	export interface NEJAopEvent<
		TArgs extends unknown[] = unknown[],
		TReturn = unknown,
	> {
		/** 原函数执行时传入的实参列表，可以直接修改此数组来篡改参数 */
		args: TArgs;
		/** 是否阻止原函数执行。若在 before 拦截器中设为 true，则原函数不会执行 */
		stopped?: boolean;
		/** 原函数的返回值。在 after 拦截器中可以读取或修改此值 */
		value?: TReturn;
	}

	/**
	 * AOP 拦截器函数签名
	 */
	export type NEJAopInterceptor<
		Args extends unknown[] = unknown[],
		Return = unknown,
	> = (event: NEJAopEvent<Args, Return>) => void;

	/**
	 * AOP 拦截的目标函数签名
	 */
	export type NEJAopTarget<This, Args extends unknown[], Return> = (
		this: This,
		...args: Args
	) => Return;
}

declare global {
	interface Window {
		/**
		 * 网易云音乐使用的 NEJ 全局框架对象
		 *
		 * 只有在 V2 版本的客户端中才会存在
		 * @see https://github.com/apoint123/nej/tree/might-be-ncm-using
		 */
		NEJ?: v2.NEJStatic;
	}

	interface Function {
		/**
		 * NEJ AOP 增强拦截器
		 *
		 * 用于在不修改原函数的基础上，无侵入地插入前置或后置逻辑
		 *
		 * 运行时行为：
		 * 1. 返回一个全新的包装函数，原函数上的静态属性不会被继承
		 * 2. 包装函数执行时，会保留当时的 `this` 上下文并透传给原函数
		 * 3. `before` 拦截器可以修改 `event.args` 或设置 `event.stopped = true` 并提供 `event.value`
		 * 4. `after` 拦截器可以读取或修改原函数产生的 `event.value`
		 * @see https://github.com/apoint123/nej/blob/39306b9a2c0f301bbb758e8e36f29f809137867b/src/base/global.js#L288-L319
		 * @note 原名 `_$aop`
		 * @param before 前置拦截器，在原函数之前执行
		 * @param after 后置拦截器，在原函数之后执行
		 * @returns 返回一个增强后的包装函数，签名与原函数完全一致
		 */
		e9<This, Args extends unknown[], Return>(
			this: v2.NEJAopTarget<This, Args, Return>,
			before?: v2.NEJAopInterceptor<Args, Return>,
			after?: v2.NEJAopInterceptor<Args, Return>,
		): v2.NEJAopTarget<This, Args, Return>;
	}
}
