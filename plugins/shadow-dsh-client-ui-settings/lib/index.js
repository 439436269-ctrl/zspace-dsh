import z from "@deepseek-ai/schemastery";
//#region lib/types/developer-tools-settings.js
/** Shared Web and desktop developer-tool preference stored by the Host. */
/** New installations and missing values enable the full interface. */
const DeveloperToolsSettingsFields = { enabled: z.boolean().default(true) };
z.object(DeveloperToolsSettingsFields);
//#endregion
//#region lib/types/index.js
/** Live preferences projected to the browser. */
const Config = z.object({
	enabled: DeveloperToolsSettingsFields["enabled"].volatile(),
	/**
	 * 允许非回环来源读写用户设置（本地遮蔽新增，默认 true）。
	 *
	 * 库存实现把设置镜像的 persistence 绑死在 isLoopback 上，于是从
	 * <NAS-IP> / 远程域名打开时「模型」等页永远报 settings are unavailable。
	 * 宿主侧并没有对应的来源检查，所以这里把策略显式化：本值会被注入为
	 * 页面全局 __DSH_SETTINGS_REMOTE__，浏览器半据此决定是否以 "host" 持久化。
	 * 置 false 即恢复库存行为。
	 */
	remoteSettings: z.boolean().default(true)
});
/** Host preferences are consumed through the configuration form projection.
* The extra remoteSettings key only feeds the index-injection global.
* @param ctx Plugin context used for optional settings presentation.
* @param config Resolved plugin config.
*/
function apply(ctx, config) {
	const allowRemote = (config && config.remoteSettings !== void 0) ? config.remoteSettings === true : true;
	// 把开关注入 index.html —— tapIndex 是 webServer 暴露的原始 html→html 变换，
	// renderIndex 会在渲染完结构化注入表之后按注册顺序跑它。
	ctx.inject(["webServer"], (child) => {
		child.effect(() => child.webServer.tapIndex((html) =>
			html.replace(/<head(\s[^>]*)?>/i, (tag) => `${tag}<script>globalThis.__DSH_SETTINGS_REMOTE__=${allowRemote ? "true" : "false"}<\/script>`)
		), "ui-settings(shadow): remote-settings flag injection");
	});
	ctx.inject(["settings"], (child) => {
		child.effect(() => child.settings.configure({ auto: false }, ctx.fiber));
	});
}
//#endregion
export { Config, apply };
