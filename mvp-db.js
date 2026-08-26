(function createFinanceDatabase(global) {
  'use strict';

  const DB_NAME = 'family-finance-mvp';
  const DB_VERSION = 1;
  const STORES = ['reviews', 'images', 'events', 'settings'];
  let databasePromise;

  const requestResult = (request) => new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('本地数据库操作失败'));
  });

  const transactionDone = (transaction) => new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('本地数据库写入失败'));
    transaction.onabort = () => reject(transaction.error || new Error('本地数据库写入已取消'));
  });

  function open() {
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('reviews')) {
          const reviews = db.createObjectStore('reviews', { keyPath: 'month' });
          reviews.createIndex('updatedAt', 'updatedAt');
        }
        if (!db.objectStoreNames.contains('images')) {
          const images = db.createObjectStore('images', { keyPath: 'id' });
          images.createIndex('month', 'month');
          images.createIndex('monthPlatform', ['month', 'platform']);
          images.createIndex('hash', 'hash');
        }
        if (!db.objectStoreNames.contains('events')) {
          const events = db.createObjectStore('events', { keyPath: 'id' });
          events.createIndex('month', 'month');
          events.createIndex('createdAt', 'createdAt');
        }
        if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        databasePromise = null;
        reject(request.error || new Error('无法打开本地数据库'));
      };
      request.onblocked = () => reject(new Error('本地数据库正在被其他页面占用，请关闭旧页面后重试'));
    });
    return databasePromise;
  }

  async function get(storeName, key) {
    const db = await open();
    return requestResult(db.transaction(storeName, 'readonly').objectStore(storeName).get(key));
  }

  async function getAll(storeName) {
    const db = await open();
    return requestResult(db.transaction(storeName, 'readonly').objectStore(storeName).getAll());
  }

  async function put(storeName, value) {
    const db = await open();
    const transaction = db.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).put(value);
    await transactionDone(transaction);
    return value;
  }

  async function putMany(storeName, values) {
    if (!values.length) return;
    const db = await open();
    const transaction = db.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    values.forEach((value) => store.put(value));
    await transactionDone(transaction);
  }

  async function listImages(month, platform) {
    const db = await open();
    const transaction = db.transaction('images', 'readonly');
    const index = transaction.objectStore('images').index('monthPlatform');
    return requestResult(index.getAll(IDBKeyRange.only([month, platform])));
  }

  async function deleteImage(id) {
    const db = await open();
    const transaction = db.transaction('images', 'readwrite');
    transaction.objectStore('images').delete(id);
    await transactionDone(transaction);
  }

  async function clearAll() {
    const db = await open();
    const transaction = db.transaction(STORES, 'readwrite');
    STORES.forEach((storeName) => transaction.objectStore(storeName).clear());
    await transactionDone(transaction);
  }

  async function addEvent(type, details = {}) {
    const event = {
      id: crypto.randomUUID(),
      type,
      createdAt: new Date().toISOString(),
      ...details
    };
    await put('events', event);
    return event;
  }

  const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('图片备份失败'));
    reader.readAsDataURL(blob);
  });

  const dataUrlToBlob = async (dataUrl) => {
    const response = await fetch(dataUrl);
    return response.blob();
  };

  async function exportBackup() {
    const [reviews, images, events, settings] = await Promise.all([
      getAll('reviews'), getAll('images'), getAll('events'), getAll('settings')
    ]);
    const serializedImages = [];
    for (const image of images) {
      serializedImages.push({ ...image, blob: undefined, dataUrl: await blobToDataUrl(image.blob) });
    }
    return {
      format: 'family-finance-local-backup',
      version: 1,
      exportedAt: new Date().toISOString(),
      reviews,
      images: serializedImages,
      events,
      settings
    };
  }

  async function importBackup(backup) {
    if (!backup || backup.format !== 'family-finance-local-backup' || backup.version !== 1) {
      throw new Error('这不是有效的家财月报本地备份文件');
    }
    const images = [];
    for (const image of backup.images || []) {
      if (!image.dataUrl) continue;
      const { dataUrl, ...metadata } = image;
      images.push({ ...metadata, blob: await dataUrlToBlob(dataUrl) });
    }
    await clearAll();
    await Promise.all([
      putMany('reviews', backup.reviews || []),
      putMany('images', images),
      putMany('events', backup.events || []),
      putMany('settings', backup.settings || [])
    ]);
  }

  global.FinanceDB = {
    open,
    getReview: (month) => get('reviews', month),
    putReview: (review) => put('reviews', review),
    listReviews: () => getAll('reviews'),
    getImage: (id) => get('images', id),
    putImages: (images) => putMany('images', images),
    listImages,
    deleteImage,
    getSetting: (key) => get('settings', key),
    setSetting: (key, value) => put('settings', { key, value, updatedAt: new Date().toISOString() }),
    addEvent,
    listEvents: () => getAll('events'),
    exportBackup,
    importBackup,
    clearAll
  };
})(window);

