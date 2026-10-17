//#region lib/types/index.js
/**
 * 远程设置分区，宿主半。
 *
 * 空的 apply：这个包之所以需要一个宿主半，只是为了让插件出现在 Loader 的
 * entry 列表里，从而让 dsh-client-modules 扫描到它的 `dsh.client` 声明、
 * 把浏览器半挂进 __DSH_BOOT__。真正的页面在 exports["./client"]。
 *
 * 它自己不注册任何设置命名空间 —— 页面读写的是别的插件已经注册好的那些。
 */
/** 宿主侧无行为。 */
function apply() {}
//#endregion
export { apply };
