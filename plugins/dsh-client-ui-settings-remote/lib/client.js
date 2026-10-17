window.__ModuleLoader__.load({
	id: "dsh-client-ui-settings-remote",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");

		//#region styles
		const css = ".zrs_section{max-width:820px;color:var(--dsw-alias-label-primary);flex-direction:column;gap:12px;display:flex}.zrs_h{margin:0;font-size:18px;font-weight:600}.zrs_intro{color:var(--dsw-alias-label-tertiary);margin:0;font-size:13px;line-height:20px}.zrs_card{border:.5px solid var(--dsw-alias-border-l2);border-radius:10px;padding:12px 14px;display:flex;flex-direction:column;gap:8px;background:var(--dsw-alias-bg-l1,transparent)}.zrs_cardTitle{margin:0;font-size:14px;font-weight:600}.zrs_note{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:18px}.zrs_err{color:var(--dsw-alias-state-error-primary,#d33);font-size:12px;margin:0;word-break:break-all}.zrs_provList{flex-direction:column;gap:8px;display:flex;margin:0;padding:0;list-style:none}.zrs_prov{border:.5px solid var(--dsw-alias-border-l2);border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:9px}.zrs_provHead{display:flex;align-items:center;gap:8px}.zrs_dot{width:8px;height:8px;border-radius:50%;flex:0 0 auto;background:var(--dsw-alias-label-quaternary,#c8c8c8)}.zrs_dotOn{background:var(--dsw-alias-state-success-primary,#2fb344)}.zrs_provName{font-size:13px;font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.zrs_state{font-size:11.5px;color:var(--dsw-alias-label-tertiary)}.zrs_row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.zrs_input{flex:1;min-width:140px;padding:6px 9px;border:.5px solid var(--dsw-alias-border-l2);border-radius:7px;background:var(--dsw-alias-bg-l1,transparent);color:inherit;font-size:12px}.zrs_btn{padding:5px 11px;border:.5px solid var(--dsw-alias-border-l2);border-radius:7px;background:transparent;color:inherit;font-size:12px;cursor:pointer;white-space:nowrap}.zrs_btn:hover:not(:disabled){background:var(--dsw-alias-bg-l2,rgba(127,127,127,.1))}.zrs_btn:disabled{opacity:.45;cursor:default}.zrs_btnPrimary{border-color:var(--dsw-alias-state-business-primary,#36f);color:var(--dsw-alias-state-business-primary,#36f)}.zrs_btnDanger{border-color:transparent;color:var(--dsw-alias-state-error-primary,#d33)}.zrs_addBtn{width:100%;padding:9px;border:.5px dashed var(--dsw-alias-border-l2);border-radius:10px;background:transparent;color:var(--dsw-alias-label-secondary,inherit);font-size:12.5px;cursor:pointer}.zrs_addBtn:hover{background:var(--dsw-alias-bg-l2,rgba(127,127,127,.08))}.zrs_badge{border:.5px solid var(--dsw-alias-border-l2);border-radius:5px;padding:1px 6px;font-size:11px;color:var(--dsw-alias-label-tertiary);flex:0 0 auto}.zrs_mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}.zrs_keyLabel{font-size:11.5px;color:var(--dsw-alias-label-tertiary);min-width:34px}.zrs_msg{font-size:11.5px;margin:0;color:var(--dsw-alias-label-tertiary);word-break:break-all}.zrs_table{border-collapse:collapse;width:100%;font-size:12px}.zrs_table td,.zrs_table th{border-bottom:.5px solid var(--dsw-alias-border-l2);padding:4px 6px;text-align:left;vertical-align:top}.zrs_pre{background:var(--dsw-alias-bg-l2,rgba(127,127,127,.08));border-radius:6px;padding:8px;margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;line-height:16px;max-height:240px;overflow:auto;white-space:pre-wrap;word-break:break-all}";
		const tagId = "dsh-client-ui-settings-remote/RemoteSettingsSection.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-client-ui-settings-remote";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		//#endregion

		//#region helpers
		/** 把 remote 的应答信封摊平成 {value} 或 {error}。 */
		async function unwrap(promise) {
			try {
				const response = await promise;
				if (response && response.ok === true) return { value: response.value };
				const error = response && response.error ? response.error : void 0;
				const message = error && error.message ? error.message : "调用失败";
				return { error: error && error.code ? error.code + ": " + message : message };
			} catch (thrown) {
				return { error: thrown && thrown.message ? thrown.message : String(thrown) };
			}
		}

		/**
		 * schemastery `toJSON()` 树的统一取值。树的节点形状是
		 * `{ type, meta, dict?, list?, inner? }`，对象字段挂在 `dict` 上。
		 * 这里对 dict / properties 两种写法都兜一下。
		 */
		function childOf(node, key) {
			if (!node || typeof node !== "object") return void 0;
			if (node.dict && node.dict[key] !== void 0) return node.dict[key];
			if (node.properties && node.properties[key] !== void 0) return node.properties[key];
			return void 0;
		}

		/**
		 * 从命名空间 schema 里取出某个供应商的凭据名（`apiKeyEnv` 的默认值）。
		 *
		 * 「模型」页就是这么做的：`settingsPath` 指向该供应商在命名空间配置里的
		 * 位置，顺着 schema 走下去读 `apiKeyEnv.meta.default`，那串名字就是凭据
		 * 存储里的引用名。取不到返回 undefined，调用方退化为按名字猜。
		 */
		function apiKeyEnvOf(schema, settingsPath) {
			try {
				let node = schema;
				for (const key of settingsPath || []) node = childOf(node, key);
				const env = childOf(node, "apiKeyEnv");
				const value = env && env.meta ? env.meta.default : void 0;
				return typeof value === "string" && value.length > 0 ? value : void 0;
			} catch {
				return void 0;
			}
		}

		/** 猜一个凭据名（schema 没给出时的兜底，用户可以自己改）。 */
		function deriveRef(provider) {
			return String(provider).toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "") + "_API_KEY";
		}

		function Json({ value }) {
			let text;
			try {
				text = JSON.stringify(value, null, 2);
			} catch {
				text = String(value);
			}
			if (text === void 0) text = "undefined";
			return (0, react_jsx_runtime.jsx)("pre", { className: "zrs_pre", children: text });
		}
		//#endregion

		//#region section component
		/**
		 * 「模型（远程）」页。
		 *
		 * 它**不读** `ctx.remote.$host.isLoopback` —— 那一行是库存设置页在非回环
		 * 地址下报 "settings are unavailable in this browser" 的原因（它让设置镜像
		 * 以 "memory" 持久化从而永不加载）。宿主侧没有任何来源判定，所以这里直接
		 * 调 remote：读设置文档、列供应商、按凭据名读写 API Key。
		 */
		function RemoteSettingsSection({ t, api }) {
			const [state, setState] = react.useState({
				status: "loading",
				routes: [],
				providers: [],
				namespaces: [],
				writable: false,
				errors: []
			});
			const [creds, setCreds] = react.useState({});
			const [openId, setOpenId] = react.useState(void 0);
			const [showPending, setShowPending] = react.useState(false);
			const [draftRef, setDraftRef] = react.useState("");
			const [draftKey, setDraftKey] = react.useState("");
			const [busy, setBusy] = react.useState(false);
			const [message, setMessage] = react.useState("");
			const [editNs, setEditNs] = react.useState("");
			const [editText, setEditText] = react.useState("");
			const [writeMessage, setWriteMessage] = react.useState("");

			const load = react.useCallback(async () => {
				setState((previous) => ({ ...previous, status: "loading" }));
				setMessage("");
				const errors = [];
				const routes = await unwrap(api.listProviders());
				if (routes.error) errors.push(t("errProviders") + " " + routes.error);
				const configurable = await unwrap(api.listConfigurableProviders());
				if (configurable.error) errors.push(t("errConfigurable") + " " + configurable.error);
				const settings = await unwrap(api.describeSettings());
				if (settings.error) errors.push(t("errSettings") + " " + settings.error);

				const view = settings.value || {};
				const namespaces = Array.isArray(view.namespaces) ? view.namespaces : [];
				const schemaOf = (ns) => {
					const found = namespaces.find((item) => item.ns === ns);
					return found ? found.schema : void 0;
				};

				// 每个可配置供应商 → 它的凭据名（schema 优先，取不到才猜）
				const providers = (Array.isArray(configurable.value) ? configurable.value : []).map((entry) => {
					const fromSchema = apiKeyEnvOf(schemaOf(entry.settingsNs), entry.settingsPath);
					return {
						id: String(entry.provider),
						displayName: String(entry.displayName === void 0 ? entry.provider : entry.displayName),
						settingsNs: String(entry.settingsNs === void 0 ? "" : entry.settingsNs),
						ref: fromSchema || deriveRef(entry.provider),
						refFromSchema: fromSchema !== void 0,
						declared: entry.declared === true,
						error: entry.error === void 0 ? void 0 : String(entry.error)
					};
				});

				// 一次批量查所有凭据状态（remote 支持数组）
				const refs = [...new Set(providers.map((item) => item.ref))];
				let described = {};
				if (refs.length > 0) {
					const response = await unwrap(api.describeCredentials(refs));
					if (response.value && typeof response.value === "object") described = response.value;
					else if (response.error) errors.push(t("errCredentials") + " " + response.error);
				}

				setCreds(described);
				setState({
					status: "ready",
					routes: Array.isArray(routes.value) ? routes.value : [],
					providers,
					namespaces,
					writable: view.writable === true,
					errors
				});
			}, [api, t]);

			(0, react.useEffect)(() => {
				load();
			}, [load]);

			const openEditor = (provider) => {
				setMessage("");
				setOpenId(provider.id);
				setDraftRef(provider.ref);
				setDraftKey("");
			};

			const saveKey = react.useCallback(async (provider) => {
				setBusy(true);
				setMessage("");
				const response = await unwrap(api.setCredential(draftRef.trim(), draftKey));
				setBusy(false);
				if (response.error) {
					setMessage(response.error);
					return;
				}
				setDraftKey("");
				setOpenId(void 0);
				setMessage(t("credSaved") + " " + draftRef.trim());
				load();
			}, [api, draftRef, draftKey, load, t]);

			const clearKey = react.useCallback(async (provider) => {
				setBusy(true);
				setMessage("");
				const response = await unwrap(api.unsetCredential(draftRef.trim()));
				setBusy(false);
				if (response.error) {
					setMessage(response.error);
					return;
				}
				setOpenId(void 0);
				setMessage(t("credCleared") + " " + draftRef.trim());
				load();
			}, [api, draftRef, load, t]);

			const writeNs = react.useCallback(async () => {
				setWriteMessage("");
				let parsed;
				try {
					parsed = JSON.parse(editText);
				} catch (error) {
					setWriteMessage(t("badJson") + " " + (error && error.message ? error.message : String(error)));
					return;
				}
				if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
					setWriteMessage(t("needObject"));
					return;
				}
				const ops = Object.keys(parsed).map((key) => ({ op: "set", path: [key], value: parsed[key] }));
				const response = await unwrap(api.mutateSettings(editNs, ops, void 0));
				if (response.error) {
					setWriteMessage(response.error);
					return;
				}
				setWriteMessage(t("written"));
				load();
			}, [api, editNs, editText, load, t]);

			// ── 供应商卡片：名字 + 已配置圆点 + 编辑 ──
			const isConfigured = (provider) => creds[provider.ref] !== void 0 && creds[provider.ref].configured === true;
			const renderProvider = (provider) => {
				const info = creds[provider.ref];
				const configured = isConfigured(provider);
				const open = openId === provider.id;
				return (0, react_jsx_runtime.jsxs)("li", {
					className: "zrs_prov",
					children: [
						(0, react_jsx_runtime.jsxs)("div", {
							className: "zrs_provHead",
							children: [
								(0, react_jsx_runtime.jsx)("span", { className: configured ? "zrs_dot zrs_dotOn" : "zrs_dot", title: configured ? t("configured") : t("notConfigured") }),
								(0, react_jsx_runtime.jsx)("span", { className: "zrs_provName", children: provider.displayName }),
								provider.declared ? (0, react_jsx_runtime.jsx)("span", { className: "zrs_badge", children: t("custom") }) : null,
								configured || provider.refFromSchema ? (0, react_jsx_runtime.jsx)("span", { className: "zrs_state zrs_mono", children: provider.ref }) : null,
								(0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "zrs_btn",
									onClick: () => (open ? setOpenId(void 0) : openEditor(provider)),
									children: open ? t("cancel") : t("edit")
								})
							]
						}),
						provider.error ? (0, react_jsx_runtime.jsx)("p", { className: "zrs_err", children: provider.error }) : null,
						open ? (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, {
							children: [
								(0, react_jsx_runtime.jsxs)("div", {
									className: "zrs_row",
									children: [
										(0, react_jsx_runtime.jsx)("span", { className: "zrs_keyLabel", children: t("keyName") }),
										(0, react_jsx_runtime.jsx)("input", { className: "zrs_input zrs_mono", value: draftRef, onChange: (event) => setDraftRef(event.target.value), placeholder: "PROVIDER_API_KEY" })
									]
								}),
								(0, react_jsx_runtime.jsxs)("div", {
									className: "zrs_row",
									children: [
										(0, react_jsx_runtime.jsx)("span", { className: "zrs_keyLabel", children: t("keyValue") }),
										(0, react_jsx_runtime.jsx)("input", { className: "zrs_input zrs_mono", type: "password", value: draftKey, onChange: (event) => setDraftKey(event.target.value), placeholder: t("valuePlaceholder"), autoComplete: "off" }),
										(0, react_jsx_runtime.jsx)("button", { type: "button", className: "zrs_btn zrs_btnPrimary", disabled: busy || draftKey.length === 0 || draftRef.trim().length === 0, onClick: () => saveKey(provider), children: t("saveCred") }),
										configured ? (0, react_jsx_runtime.jsx)("button", { type: "button", className: "zrs_btn zrs_btnDanger", disabled: busy, onClick: () => clearKey(provider), children: t("clearCred") }) : null
									]
								}),
								(0, react_jsx_runtime.jsx)("p", {
									className: "zrs_msg",
									children: configured
										? t("configured") + " · " + t("source") + " " + String(info && info.source !== void 0 ? info.source : "-") + " · " + t("writable") + " " + String(info && info.writable)
										: t("notConfigured") + " — " + t("credHint")
								})
							]
						}) : null
					]
				}, provider.id);
			};
			// 可见 = 凭据已配置，或者在设置文档里被显式声明过。后者是必需的：
			// Ollama 这类本地供应商不需要 API Key，永远"未配置"，但它确实是一个
			// 在用的供应商 —— 库存「模型」页同样把它显示为一张 [自定义] 卡片。
			const isVisible = (provider) => isConfigured(provider) || provider.declared === true;
			const visibleProviders = state.providers.filter(isVisible);
			const pendingProviders = state.providers.filter((provider) => !isVisible(provider));

			const routeRows = state.routes.map((route) =>
				(0, react_jsx_runtime.jsxs)("tr", {
					children: [
						(0, react_jsx_runtime.jsx)("td", { className: "zrs_mono", children: String(route.id) }),
						(0, react_jsx_runtime.jsx)("td", { children: String(route.name === void 0 ? "" : route.name) })
					]
				}, String(route.id) + "/" + String(route.name))
			);

			const nsCards = state.namespaces.map((view) => {
				const userText = (() => {
					try {
						return JSON.stringify(view.user === void 0 ? {} : view.user);
					} catch {
						return "{}";
					}
				})();
				return (0, react_jsx_runtime.jsxs)("div", {
					className: "zrs_prov",
					children: [
						(0, react_jsx_runtime.jsxs)("div", {
							className: "zrs_row",
							children: [
								(0, react_jsx_runtime.jsx)("strong", { className: "zrs_mono", style: { flex: "1" }, children: String(view.ns) }),
								(0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "zrs_btn",
									onClick: () => {
										setEditNs(String(view.ns));
										try {
											setEditText(JSON.stringify(view.user === void 0 ? {} : view.user, null, 2));
										} catch {
											setEditText("{}");
										}
										setWriteMessage("");
									},
									children: t("edit")
								})
							]
						}),
						(0, react_jsx_runtime.jsx)("p", { className: "zrs_msg zrs_mono", children: userText.length > 200 ? userText.slice(0, 200) + "…" : userText }),
						(0, react_jsx_runtime.jsx)("details", {
							children: [
								(0, react_jsx_runtime.jsx)("summary", { className: "zrs_msg", children: t("effective") }),
								Json({ value: view.value })
							]
						})
					]
				}, String(view.ns));
			});

			return (0, react_jsx_runtime.jsxs)("div", {
				className: "zrs_section",
				children: [
					(0, react_jsx_runtime.jsx)("h2", { className: "zrs_h", children: t("title") }),
					(0, react_jsx_runtime.jsx)("p", { className: "zrs_intro", children: t("intro") }),

					state.errors.length > 0 ? (0, react_jsx_runtime.jsx)("div", {
						className: "zrs_card",
						children: state.errors.map((text, index) => (0, react_jsx_runtime.jsx)("p", { className: "zrs_err", children: text }, String(index)))
					}) : null,
					message ? (0, react_jsx_runtime.jsx)("p", { className: "zrs_msg", children: message }) : null,

					// ── 模型供应商：填 API Key ──
					(0, react_jsx_runtime.jsxs)("div", {
						className: "zrs_card",
						children: [
							(0, react_jsx_runtime.jsxs)("div", {
								className: "zrs_row",
								children: [
									(0, react_jsx_runtime.jsx)("h3", { className: "zrs_cardTitle", style: { flex: "1" }, children: t("providers") }),
									(0, react_jsx_runtime.jsx)("button", { type: "button", className: "zrs_btn", onClick: load, children: t("reload") })
								]
							}),
							(0, react_jsx_runtime.jsx)("p", { className: "zrs_note", children: t("providersNote") }),
							state.status === "loading" ? (0, react_jsx_runtime.jsx)("p", { className: "zrs_note", children: t("loading") }) : state.providers.length === 0 ? (0, react_jsx_runtime.jsx)("p", { className: "zrs_note", children: t("noProviders") }) : (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, {
								children: [
									visibleProviders.length === 0
										? (0, react_jsx_runtime.jsx)("p", { className: "zrs_note", children: t("noneConfigured") })
										: (0, react_jsx_runtime.jsx)("ul", { className: "zrs_provList", children: visibleProviders.map(renderProvider) }),
									pendingProviders.length === 0 ? null : (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "zrs_addBtn",
										onClick: () => setShowPending((value) => !value),
										children: showPending ? t("collapseProvider") : t("addProvider")
									}),
									showPending ? (0, react_jsx_runtime.jsx)("ul", { className: "zrs_provList", children: pendingProviders.map(renderProvider) }) : null
								]
							})
						]
					}),

					// ── 模型路由 ──
					(0, react_jsx_runtime.jsxs)("div", {
						className: "zrs_card",
						children: [
							(0, react_jsx_runtime.jsx)("h3", { className: "zrs_cardTitle", children: t("routes") }),
							(0, react_jsx_runtime.jsx)("p", { className: "zrs_note", children: t("routesNote") }),
							routeRows.length === 0 ? (0, react_jsx_runtime.jsx)("p", { className: "zrs_note", children: t("noRoutes") }) : (0, react_jsx_runtime.jsxs)("table", {
								className: "zrs_table",
								children: [
									(0, react_jsx_runtime.jsx)("thead", { children: (0, react_jsx_runtime.jsxs)("tr", { children: [(0, react_jsx_runtime.jsx)("th", { children: "provider" }), (0, react_jsx_runtime.jsx)("th", { children: "model" })] }) }),
									(0, react_jsx_runtime.jsx)("tbody", { children: routeRows })
								]
							})
						]
					}),

					// ── 设置文档 ──
					(0, react_jsx_runtime.jsxs)("div", {
						className: "zrs_card",
						children: [
							(0, react_jsx_runtime.jsxs)("div", {
								className: "zrs_row",
								children: [
									(0, react_jsx_runtime.jsx)("h3", { className: "zrs_cardTitle", style: { flex: "1" }, children: t("document") }),
									(0, react_jsx_runtime.jsx)("span", { className: "zrs_note", children: t("writable") + ": " + String(state.writable) })
								]
							}),
							(0, react_jsx_runtime.jsx)("p", { className: "zrs_note", children: t("docNote") }),
							nsCards.length === 0 ? (0, react_jsx_runtime.jsx)("p", { className: "zrs_note", children: t("noNamespaces") }) : (0, react_jsx_runtime.jsx)("div", { className: "zrs_provList", children: nsCards }),
							editNs ? (0, react_jsx_runtime.jsxs)("div", {
								className: "zrs_prov",
								children: [
									(0, react_jsx_runtime.jsx)("p", { className: "zrs_note", children: t("editing") + " " + editNs }),
									(0, react_jsx_runtime.jsx)("textarea", { className: "zrs_input zrs_mono", style: { minHeight: "150px" }, value: editText, onChange: (event) => setEditText(event.target.value) }),
									(0, react_jsx_runtime.jsxs)("div", {
										className: "zrs_row",
										children: [
											(0, react_jsx_runtime.jsx)("button", { type: "button", className: "zrs_btn zrs_btnPrimary", onClick: writeNs, children: t("save") }),
											(0, react_jsx_runtime.jsx)("button", { type: "button", className: "zrs_btn", onClick: () => { setEditNs(""); setWriteMessage(""); }, children: t("cancel") })
										]
									}),
									writeMessage ? (0, react_jsx_runtime.jsx)("p", { className: "zrs_msg", children: writeMessage }) : null
								]
							}) : null
						]
					})
				]
			});
		}
		//#endregion

		//#region locales
		const zh = {
			nav: "模型（远程）",
			title: "模型（远程）",
			intro: "直接从服务端读写模型供应商与 API Key。这一页不读 isLoopback 闸门，所以在 <NAS-IP> / 远程域名下同样可用。",
			providers: "模型供应商",
			providersNote: "只列已配置 API Key、或在设置文档里声明过的供应商。点「编辑」填 Key —— 值只单向写入，读不回来。",
			addProvider: "＋ 添加模型提供商",
			collapseProvider: "收起未配置的提供商",
			custom: "自定义",
			noneConfigured: "还没有配置任何 API Key。点下面的「＋ 添加模型提供商」开始。",
			routes: "模型路由",
			routesNote: "宿主实际注册的所有 provider / model 路由。想确认某个供应商有没有生效，看这里。",
			document: "设置文档",
			docNote: "各命名空间的用户分节。展开可看生效值；点「编辑」改用户分节（等同设置页保存）。",
			effective: "展开查看生效值",
			edit: "编辑",
			cancel: "取消",
			save: "写回",
			reload: "刷新",
			loading: "加载中…",
			saveCred: "保存 Key",
			clearCred: "清除",
			keyName: "凭据名",
			keyValue: "Key",
			valuePlaceholder: "粘贴 API Key",
			credSaved: "已保存：",
			credCleared: "已清除：",
			credHint: "填一个值即可启用（凭据名通常由供应商 schema 给出，也可自己改）。",
			configured: "已配置",
			notConfigured: "未配置",
			source: "来源",
			writable: "可写",
			written: "已写回。",
			badJson: "JSON 解析失败：",
			needObject: "需要一个 JSON 对象（顶层键 → 值）。",
			noRoutes: "没有任何路由。llm-pi-ai 休眠时就是这种状态。",
			noProviders: "宿主没有报告任何可配置供应商。",
			noNamespaces: "宿主没有返回任何设置命名空间。",
			editing: "正在编辑：",
			errProviders: "读取 provider 失败：",
			errConfigurable: "读取可配置供应商失败：",
			errSettings: "读取设置文档失败：",
			errCredentials: "读取凭据状态失败："
		};
		const en = {
			nav: "Models (remote)",
			title: "Models (remote)",
			intro: "Read and write model providers and API keys straight from the host. This page does not consult the isLoopback gate, so it works from <NAS-IP> or a remote domain too.",
			providers: "Model providers",
			providersNote: "Only providers with an API key configured are listed. Click Edit to enter one — values travel one way only.",
			addProvider: "＋ Add a model provider",
			collapseProvider: "Hide unconfigured providers",
			custom: "custom",
			noneConfigured: "No API key configured yet. Use “＋ Add a model provider” below.",
			routes: "Model routes",
			routesNote: "Every provider/model route the host actually registered.",
			document: "Settings document",
			docNote: "The user section of every namespace. Expand for the effective value; Edit rewrites the user section.",
			effective: "show effective value",
			edit: "Edit",
			cancel: "Cancel",
			save: "Write back",
			reload: "Reload",
			loading: "Loading…",
			saveCred: "Save key",
			clearCred: "Clear",
			keyName: "ref",
			keyValue: "Key",
			valuePlaceholder: "paste the API key",
			credSaved: "Saved: ",
			credCleared: "Cleared: ",
			credHint: "any value enables it (the ref usually comes from the provider schema; you may edit it).",
			configured: "configured",
			notConfigured: "not configured",
			source: "source",
			writable: "writable",
			written: "Written back.",
			badJson: "JSON parse failed: ",
			needObject: "A JSON object is required.",
			noRoutes: "No routes at all. That is what a dormant llm-pi-ai looks like.",
			noProviders: "The host reported no configurable providers.",
			noNamespaces: "The host returned no settings namespaces.",
			editing: "Editing: ",
			errProviders: "Provider read failed: ",
			errConfigurable: "Configurable provider read failed: ",
			errSettings: "Settings document read failed: ",
			errCredentials: "Credential read failed: "
		};
		//#endregion

		//#region plugin body
		const NS = "settings.remote";
		const inject = ["slots", "locale", "remote", "remote.credentials", "remote.llm", "remote.settings"];

		/**
		 * 挂载「模型（远程）」分区。
		 * @param ctx - 浏览器插件上下文。
		 */
		function apply(ctx) {
			const t = ctx.locale.bind(NS);
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "ui-settings-remote: dictionaries");

			const api = {
				listProviders: () => ctx.remote.llm.listProviders(),
				listConfigurableProviders: () => ctx.remote.llm.listConfigurableProviders(),
				describeSettings: () => ctx.remote.settings.describe(),
				mutateSettings: (ns, ops, revision) => ctx.remote.settings.mutate(ns, ops, revision),
				describeCredentials: (refs) => ctx.remote.credentials.describe(refs),
				setCredential: (ref, value) => ctx.remote.credentials.set(ref, value),
				unsetCredential: (ref) => ctx.remote.credentials.unset(ref)
			};

			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "remote",
				order: 12,
				label: () => t("nav"),
				locale: NS,
				inject: () => ({ api })
			}, RemoteSettingsSection));
		}
		//#endregion

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
