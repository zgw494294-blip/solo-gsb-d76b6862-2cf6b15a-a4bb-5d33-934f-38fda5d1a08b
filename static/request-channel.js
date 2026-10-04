/* 共享请求通道（RequestChannel）——不依赖 DOM 的纯前端控制模块。
 *
 * 供四条请求路径共用：
 *   - 原求解      POST /api/solve            （归属键＝只增不减的求解输入纪元）
 *   - 不透明度反推 POST /api/infer-opacity     （归属键＝参与输入指纹）
 *   - 相邻同色合并 POST /api/merge-layers    （归属键＝参与输入指纹）
 *   - 校准处理链   POST /api/calibration-chain（归属键＝参与输入指纹，含当前有效求解顺序与全部步骤）
 *
 * 统一收敛三处重复的「请求登记、归属检查与加载收尾」：
 *   - 请求登记 begin：从永不归零的单调计数器取得请求序号（请求以任何方式结束后
 *     序号也不复用），同时记录发出时的归属键；
 *   - 归属检查 owns / finish：响应头返回、JSON 读取结束与异常收尾三处都必须核对，
 *     只有「仍是当前在途请求，且发出后归属键未变」的响应可以落地；过期成功、
 *     HTTP 错误、连接异常或解析失败一律不更新结果、错误或较新请求的加载；
 *   - 加载收尾：有效请求结束、被输入变化废弃（reap）或被业务动作显式废弃（cancel）
 *     时摘除在途身份，并通过 onLoadingChange 回调结束【本通道】的加载态。
 *
 * 四个通道各自独立，可同时等待，请求身份与加载收尾互不影响。
 * 参数准备、渲染与方案资格（如反推「已应用」资格、合并「可确认」资格）不属本模块，
 * 仍由各业务管理；HTTP 方法、路径、字段与状态码同样保持原样。
 */
"use strict";

class RequestChannel {
  // onLoadingChange(busy)：本通道加载态变化时回调（busy=true 开始 / false 结束）。
  // 各通道开始时的提示文案不同（「计算中… / 反推中… / 生成方案中…」），由业务
  // 自行设置；统一的收尾动作可放在 busy=false 分支。求解通道的结束提示随结果 /
  // 错误渲染而定，可不传回调，收尾 DOM 仍由业务处理。
  constructor({ onLoadingChange = null } = {}) {
    this._seq = 0;              // 单调递增的请求序号源，永不归零
    this._inflightId = 0;       // 当前仍可落地的在途请求序号；0 表示无
    this._inflightKey = undefined; // 在途请求登记时的归属键（纪元或输入指纹）
    this._onLoadingChange = onLoadingChange;
  }

  // 是否存在仍可落地的在途请求
  isBusy() {
    return this._inflightId !== 0;
  }

  // 登记一次新请求：取得新序号、记录归属键并进入加载态。返回 { id, key }，
  // 供后续 owns / finish 核对。旧在途身份（若有）立即被新序号取代——较早请求
  // 此后无论何种结局都无法再通过归属检查。
  begin(key) {
    const id = ++this._seq;
    this._inflightId = id;
    this._inflightKey = key;
    if (this._onLoadingChange) this._onLoadingChange(true);
    return { id, key };
  }

  // 归属核对：响应头返回、JSON 读取结束及异常收尾时调用。
  // 同时满足三条才属于当前请求：
  //   1) 序号仍是当前在途序号（未被较新请求取代、未被显式废弃）；
  //   2) 当前归属键仍等于该请求发出时登记的键（输入未变化）；
  //   3) 调用方给出的当前键与登记键一致（防复用、防改回原值复活）。
  owns(id, key, currentKey) {
    return (
      this._inflightId === id &&
      this._inflightKey === key &&
      currentKey === key
    );
  }

  // 有效请求的正常收尾：归属通过才摘除在途身份并结束加载态，返回 true；
  // 已过期（含成功、HTTP 错误、连接异常、解析失败四种结局的旧响应）返回 false，
  // 不触碰任何结果、错误与加载状态（尤其不会结束较新请求的加载）。
  finish(id, key, currentKey) {
    if (!this.owns(id, key, currentKey)) return false;
    this._inflightId = 0;
    this._inflightKey = undefined;
    if (this._onLoadingChange) this._onLoadingChange(false);
    return true;
  }

  // 输入变化时废弃旧请求：仅当当前归属键已偏离在途请求登记键时，摘除其在途
  // 身份并结束加载态；键未变则保留（三个通道可同时等待，彼此不波及）。
  // 归属键只增不减 / 指纹不会回到旧值，因此改回原值也不能让旧请求复活。
  // 返回是否发生了废弃。
  reap(currentKey) {
    if (this._inflightId !== 0 && currentKey !== this._inflightKey) {
      this._inflightId = 0;
      this._inflightKey = undefined;
      if (this._onLoadingChange) this._onLoadingChange(false);
      return true;
    }
    return false;
  }

  // 业务动作显式废弃当前在途请求（如一次有效的反推应用永久作废此前在途反推）：
  // 无条件摘除在途身份。默认同时结束加载态；调用方紧接着会切换到另一加载提示
  // （如成环确认接续求解）时可传 { silent: true } 跳过回调以免提示闪烁。
  // 序号同样不复用，旧请求此后的任何结局都在归属检查处被丢弃。
  cancel({ silent = false } = {}) {
    if (this._inflightId === 0) return false;
    this._inflightId = 0;
    this._inflightKey = undefined;
    if (!silent && this._onLoadingChange) this._onLoadingChange(false);
    return true;
  }
}
