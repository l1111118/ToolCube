/**
 * ToolCube - Storage Manager
 *
 * 面向**设置页**的数据导入 / 导出 / 清空实现（`chrome.storage.local` + IndexedDB）。
 *
 * ## 与 background.js 的分工
 *
 * 后台有自己的轻量存储访问（直接调用 `chrome.storage.local`）与一个复用的
 * IndexedDB 连接；本类只服务设置页那三个动作：导出全部数据、导入全部数据、清空全部数据。
 * 早期这里还实现了同步/收藏/文件缓存/游标遍历等一整套抽象，但**没有任何调用方**，
 * 属于死代码，已移除 —— 保留未被使用的"通用能力"只会让维护者误判实际依赖范围。
 *
 * ## 数据库结构必须与后台一致
 *
 * IndexedDB 按 `(库名, 版本号)` 判定升级：只要版本号相同，`onupgradeneeded` 只在
 * **第一个**打开它的上下文里触发一次。因此本文件与 `background.js` 的 `createIndexedDB()`
 * 必须声明完全相同的对象仓库与索引，否则实际结构会取决于"谁先打开"，形成隐式耦合。
 * 改动任一处时请同步另一处。
 *
 * @version 1.3.0
 */

/** 存储键名与数据库结构常量（后台 `CONFIG.STORAGE_KEYS` 为同一套取值） */
const STORAGE_KEYS = {
  SETTINGS: 'toolbox_settings',
  FAVORITES: 'toolbox_favorites',
  TOOLS_STATUS: 'tools_status',
  HISTORY: 'toolbox_history',
  USER_PREFS: 'user_preferences',
  CACHE: 'toolbox_cache',

  DB_NAME: 'ToolboxDB',
  DB_VERSION: 1,
  STORE_HISTORY: 'history',
  STORE_TOOL_DATA: 'toolData',
  STORE_FILE_CACHE: 'fileCache'
};

export class StorageManager {
  constructor() {
    this.db = null;
    this.dbReady = this.initIndexedDB();
  }

  // ==================== IndexedDB ====================

  /**
   * 打开（必要时创建）IndexedDB
   * @returns {Promise<IDBDatabase>}
   */
  async initIndexedDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(STORAGE_KEYS.DB_NAME, STORAGE_KEYS.DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        if (!db.objectStoreNames.contains(STORAGE_KEYS.STORE_HISTORY)) {
          const historyStore = db.createObjectStore(STORAGE_KEYS.STORE_HISTORY, {
            keyPath: 'id',
            autoIncrement: true
          });
          historyStore.createIndex('toolId', 'toolId', { unique: false });
          historyStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        if (!db.objectStoreNames.contains(STORAGE_KEYS.STORE_TOOL_DATA)) {
          db.createObjectStore(STORAGE_KEYS.STORE_TOOL_DATA, { keyPath: 'toolId' });
        }

        if (!db.objectStoreNames.contains(STORAGE_KEYS.STORE_FILE_CACHE)) {
          const fileStore = db.createObjectStore(STORAGE_KEYS.STORE_FILE_CACHE, { keyPath: 'id' });
          fileStore.createIndex('expireAt', 'expireAt', { unique: false });
        }
      };
    });
  }

  /**
   * 确保数据库已就绪（构造时的连接可能尚未完成）
   * @returns {Promise<IDBDatabase>}
   */
  async ensureDB() {
    if (!this.db) {
      await this.dbReady;
    }
    return this.db;
  }

  // ==================== chrome.storage.local ====================

  /** 读取（keys 为空则取全部） */
  async getLocal(keys = null) {
    return await chrome.storage.local.get(keys);
  }

  /** 写入 */
  async setLocal(data) {
    await chrome.storage.local.set(data);
  }

  /** 清空 */
  async clearLocal() {
    await chrome.storage.local.clear();
  }

  // ==================== IndexedDB 基础操作 ====================

  /**
   * 新增记录
   * @returns {Promise<number|string>} 新记录的 key
   */
  async dbAdd(storeName, data) {
    const db = await this.ensureDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([storeName], 'readwrite');
      const request = transaction.objectStore(storeName).add(data);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * 新增或覆盖记录
   * @returns {Promise<number|string>} 记录的 key
   */
  async dbPut(storeName, data) {
    const db = await this.ensureDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([storeName], 'readwrite');
      const request = transaction.objectStore(storeName).put(data);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * 读取全部记录
   * @returns {Promise<Array>}
   */
  async dbGetAll(storeName) {
    const db = await this.ensureDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([storeName], 'readonly');
      const request = transaction.objectStore(storeName).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  /** 清空某个对象仓库 */
  async dbClear(storeName) {
    const db = await this.ensureDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([storeName], 'readwrite');
      const request = transaction.objectStore(storeName).clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // ==================== 历史记录 ====================

  /**
   * 读取全部历史记录（按时间倒序）
   * @param {number} limit - 限制数量
   * @returns {Promise<Array>}
   */
  async getAllHistory(limit = 100) {
    const records = await this.dbGetAll(STORAGE_KEYS.STORE_HISTORY);
    return records
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  // ==================== 数据导入导出 ====================

  /**
   * 导出全部数据（chrome.storage.local + 工具数据 + 历史记录）
   * @returns {Promise<object>}
   */
  async exportAllData() {
    const [localData, toolData, history] = await Promise.all([
      this.getLocal(),
      this.dbGetAll(STORAGE_KEYS.STORE_TOOL_DATA),
      this.getAllHistory(Number.MAX_SAFE_INTEGER)
    ]);

    return {
      version: chrome.runtime.getManifest().version,
      exportDate: new Date().toISOString(),
      data: localData,
      toolData,
      history
    };
  }

  /**
   * 导入数据
   * 兼容旧格式（`sync` + `local`）与当前格式（`data`）。
   * @param {object} data
   */
  async importAllData(data) {
    const importObj = data.data || { ...(data.sync || {}), ...(data.local || {}) };
    await this.setLocal(importObj);

    if (data.toolData) {
      for (const item of data.toolData) {
        await this.dbPut(STORAGE_KEYS.STORE_TOOL_DATA, item);
      }
    }

    if (data.history) {
      for (const item of data.history) {
        // 导入时丢弃原自增主键，避免与既有记录冲突
        const { id, ...rest } = item;
        await this.dbAdd(STORAGE_KEYS.STORE_HISTORY, rest);
      }
    }
  }

  /** 清空全部数据（storage.local + 三个对象仓库） */
  async clearAllData() {
    await Promise.all([
      this.clearLocal(),
      this.dbClear(STORAGE_KEYS.STORE_HISTORY),
      this.dbClear(STORAGE_KEYS.STORE_TOOL_DATA),
      this.dbClear(STORAGE_KEYS.STORE_FILE_CACHE)
    ]);
  }
}

export default StorageManager;
