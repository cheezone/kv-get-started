import { Hono } from 'hono';

export interface Env {
  USER_NOTIFICATION: KVNamespace;
  DB: D1Database;
  DOUYIN_API_KEY?: string;
  DOUYIN_WTF_BASE_URL?: string;
}

import type { UserInfoResponse } from '@logto/node';

// Logto 管理 API 配置
const logtoConfig = {
  appId: 'uvyv6ldta8f2hhkchbh7f',
  tenantId: 'es50q2',
  appSecret: '7y7UMXNBku2jVS1iuZgfHXfmztgRZVgH',
};

const logtoEndpoint = 'https://es50q2.logto.app';
const tokenEndpoint = `${logtoEndpoint}/oidc/token`;
const applicationId = logtoConfig.appId;
const applicationSecret = logtoConfig.appSecret;
const tenantId = logtoConfig.tenantId;

// 获取管理 API access token
const fetchManagementAccessToken = async (): Promise<string> => {
  const res = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${btoa(`${applicationId}:${applicationSecret}`)}`,
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      resource: `https://${tenantId}.logto.app/api`,
      scope: 'all',
    }).toString(),
  });
  if (!res.ok) {
    throw new Error('获取管理 access_token 失败');
  }
  const data: any = await res.json();
  return data.access_token;
};

const userInfoEndpoint = `${logtoEndpoint}/oidc/me`;

const getUserInfo = async (request: Request): Promise<UserInfoResponse> => {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw new Error('无效的授权请求头'); // 中文注释
  }

  // 用户的 access token，仅能获取用户自己的信息
  const token = authHeader.split(' ')[1];
  console.log('token', token); // 调试用，可以移除

  // 获取用户信息请求
  const response = await fetch(`${userInfoEndpoint}`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  if (!response.ok) {
    throw new Error('获取用户信息失败'); // 中文注释
  }

  const userInfo = await response.json();
  console.log('userInfo', userInfo);  // 调试用，可以移除

  return userInfo as UserInfoResponse;
}

// 获取用户自定义数据
const fetchUserCustomData = async (accessToken: string, userId: string) => {
  const res = await fetch(`${logtoEndpoint}/api/users/${userId}/custom-data`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!res.ok) {
    throw new Error('获取用户自定义数据失败');
  }
  return await res.json();
};

// 更新用户自定义数据（部分更新）
const patchUserCustomData = async (accessToken: string, userId: string, customData: Record<string, any>) => {
  const res = await fetch(`${logtoEndpoint}/api/users/${userId}/custom-data`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ customData }),
  });
  if (!res.ok) {
    throw new Error('更新用户自定义数据失败');
  }
  return await res.json();
};

// 获取或初始化 puzzleCount
const getOrInitPuzzleCount = async (accessToken: string, userId: string): Promise<number> => {
  let customData: any = await fetchUserCustomData(accessToken, userId);
  if (typeof customData.puzzleCount !== 'number') {
    // 没有拼图次数，初始化为 1
    customData = await patchUserCustomData(accessToken, userId, { puzzleCount: 1 });
    return 1;
  }
  return customData.puzzleCount;
};

// 使用一次 puzzleCount
const usePuzzleCount = async (accessToken: string, userId: string): Promise<number> => {
  let customData: any = await fetchUserCustomData(accessToken, userId);
  let count = typeof customData.puzzleCount === 'number' ? customData.puzzleCount : 0;
  if (count > 0) {
    count -= 1;
    await patchUserCustomData(accessToken, userId, { puzzleCount: count });
    return count;
  } else {
    throw new Error('拼图次数不足，无法使用');
  }
};

// 增加 puzzleCount
const addPuzzleCount = async (accessToken: string, userId: string, addNum: number = 1): Promise<number> => {
  let customData: any = await fetchUserCustomData(accessToken, userId);
  let count = typeof customData.puzzleCount === 'number' ? customData.puzzleCount : 0;
  count += addNum;
  await patchUserCustomData(accessToken, userId, { puzzleCount: count });
  return count;
};

const app = new Hono<{ Bindings: Env }>();

// 用户认证中间件，检查 token 并缓存用户信息到 KV
const authMiddleware = async (c: any, next: any) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.text('无效的授权请求头', 401);
  }
  const token = authHeader.split(' ')[1];
  try {
    const userInfo = await getUserInfoWithCache(c, token);
    c.set('userInfo', userInfo); // 挂到 context

    // 从 D1 获取用户余额
    const userId = userInfo.sub;
    let balance = 0; // 默认余额为 0
    try {
      // 确保查询只选择 balance 列，或者返回整个对象然后访问 balance
      // 如果只想获取 balance 列的值，可以使用 first('balance')
      // const userBalance = await c.env.DB.prepare('SELECT balance FROM balances WHERE user_id = ?').bind(userId).first('balance');
      // if (typeof userBalance === 'number') {
      //   balance = userBalance;
      // }
      // 或者，获取整行记录
      const result = await c.env.DB.prepare('SELECT balance FROM balances WHERE user_id = ?').bind(userId).first();
      if (result && typeof (result as any).balance === 'number') {
        balance = (result as any).balance;
      } else {
        // 如果 balances 表中没有该用户，可以考虑在此处创建一条记录，并赋予初始余额
        // 例如：await c.env.DB.prepare('INSERT INTO balances (user_id, balance) VALUES (?, ?)')
        //           .bind(userId, 0) // 假设初始余额为0
        //           .run();
        // 为了简单起见，这里我们只设置默认值0，具体初始化逻辑可以根据业务需求调整
        console.log(`User ${userId} not found in balances table or balance is not a number, defaulting to balance 0.`);
      }
    } catch (dbError) {
      console.error(`Error fetching balance for user ${userId} from D1:`, dbError);
      // 根据错误处理策略，可以选择返回错误或使用默认余额继续
      // return c.text('获取用户余额失败', 500);
    }
    c.set('balance', balance); // 将余额挂到 context

    await next();
  } catch (err) {
    const msg = err instanceof Error ? err.message : '认证失败';
    return c.text(msg, 401);
  }
};

// 应用到所有 /v1 路由
app.use('/v1/*', authMiddleware);

// 声明 Hono Context 变量类型，支持 c.get('userInfo')
declare module 'hono' {
  interface ContextVariableMap {
    userInfo: UserInfoResponse;
    balance: number;
  }
}

// /v1/puzzle-count GET 路由（KV 优先，用户信息也缓存）
app.get('/v1/puzzle-count', async (c) => {
  try {
    const userInfo = c.get('userInfo');
    const userId = userInfo.sub;
    const kvKey = `puzzleCount:${userId}`;
    // 先查 KV
    let countStr = await c.env.USER_NOTIFICATION.get(kvKey);
    if (countStr !== null) {
      // KV 命中，直接返回
      return c.text(countStr);
    }
    // KV 没有，去 Logto 拉
    const accessToken = await fetchManagementAccessToken();
    const count = await getOrInitPuzzleCount(accessToken, userId);
    // 写入 KV，设置 30 天过期
    await c.env.USER_NOTIFICATION.put(kvKey, count.toString(), { expirationTtl: 2592000 });
    return c.text(count.toString());
  } catch (err) {
    const msg = err instanceof Error ? err.message : '获取拼图次数失败';
    return c.text(msg, 500);
  }
});

// /v1/puzzle-count/use POST 路由（KV 优先，异步同步 Logto）
app.post('/v1/puzzle-count/use', async (c) => {
  try {
    const userInfo = c.get<any>('userInfo') as UserInfoResponse;
    const userId = userInfo.sub;
    const kvKey = `puzzleCount:${userId}`;
    // 先查 KV
    let countStr = await c.env.USER_NOTIFICATION.get(kvKey);
    let count = countStr ? parseInt(countStr, 10) : 0;
    if (isNaN(count) || count <= 0) {
      return c.text('拼图次数不足，无法使用', 400);
    }
    count -= 1;
    await c.env.USER_NOTIFICATION.put(kvKey, count.toString(), { expirationTtl: 2592000 });
    // 异步同步到 Logto
    Promise.resolve().then(async () => {
      try {
        const accessToken = await fetchManagementAccessToken();
        await patchUserCustomData(accessToken, userId, { puzzleCount: count });
      } catch { }
    });
    return c.text(count.toString());
  } catch (err) {
    const msg = err instanceof Error ? err.message : '使用拼图次数失败';
    return c.text(msg, 400);
  }
});

// /v1/puzzle-count/add POST 路由（KV 优先，异步同步 Logto）
app.post('/v1/puzzle-count/add', async (c) => {
  try {
    const userInfo = c.get<any>('userInfo') as UserInfoResponse;
    const userId = userInfo.sub;
    const kvKey = `puzzleCount:${userId}`;
    // 先查 KV
    let countStr = await c.env.USER_NOTIFICATION.get(kvKey);
    let count = countStr ? parseInt(countStr, 10) : 0;
    let addNum = 1;
    try {
      const body: any = await c.req.json();
      if (typeof body.addNum === 'number' && body.addNum > 0) {
        addNum = body.addNum;
      }
    } catch { }
    count += addNum;
    await c.env.USER_NOTIFICATION.put(kvKey, count.toString(), { expirationTtl: 2592000 });
    // 异步同步到 Logto
    Promise.resolve().then(async () => {
      try {
        const accessToken = await fetchManagementAccessToken();
        await patchUserCustomData(accessToken, userId, { puzzleCount: count });
      } catch { }
    });
    return c.text(count.toString());
  } catch (err) {
    const msg = err instanceof Error ? err.message : '增加拼图次数失败';
    return c.text(msg, 400);
  }
});

// 优先用 KV 缓存获取用户信息
const getUserInfoWithCache = async (c: any, token: string): Promise<UserInfoResponse> => {
  const kvKey = `userInfo:${token}`;
  // 先查 KV
  const cached = await c.env.USER_NOTIFICATION.get(kvKey);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch { }
  }
  // 没有缓存，去 Logto 拉
  const userInfo = await getUserInfo(new Request(c.req.url, { headers: { Authorization: `Bearer ${token}` } }));
  // 写入 KV，设置 1 小时过期
  await c.env.USER_NOTIFICATION.put(kvKey, JSON.stringify(userInfo), { expirationTtl: 3600 });
  return userInfo;
};

// Helper function to get environment variables
const getEnv = (c: any) => {
  return {
    DOUYIN_WTF_BASE_URL: c.env.DOUYIN_WTF_BASE_URL || 'https://douyin.wtf', // 提供一个默认值或确保环境变量已设置
    // 可以添加其他需要的环境变量
  };
};

// ... app.post('/v1/media/direct-download-info', ...)
app.post('/v1/media/direct-download-info', async (c) => {
  const endpointName = '/v1/media/direct-download-info';
  try {
    const userInfo = c.get('userInfo');
    const userId = userInfo.sub;
    let currentBalance = c.get('balance');
    console.log(`[${endpointName}] User: ${userId}, Balance: ${currentBalance} initiated.`);

    const body = await c.req.json();
    const mediaUrl = body.url;
    console.log(`[${endpointName}] Received mediaUrl: ${mediaUrl}`);

    if (!mediaUrl || typeof mediaUrl !== 'string') {
      console.error(`[${endpointName}] Invalid mediaUrl: ${mediaUrl}`);
      return c.json({ error: '缺少或无效的媒体链接' }, 400);
    }

    // --- 0. 前置余额检查 --- (如果严格要求余额不足时不进行任何解析)
    const preliminaryCost = 1; // 假设固定成本为1，用于预检
    if (currentBalance < preliminaryCost) {
      console.warn(`[${endpointName}] Preliminary check: Balance insufficient for user ${userId}. Balance: ${currentBalance}, Cost: ${preliminaryCost}`);
      return c.json({ error: '余额不足，无法进行解析操作', currentBalance: currentBalance, required: preliminaryCost }, 402);
    }

    // --- 1. 解析媒体链接 ---
    // ... (后续的解析、提取下载链接、最终扣费逻辑不变，但在扣费前仍会再次检查余额，以防并发)
    // ... (确保在最终扣费的 const cost = 1; 之后，仍然有 if (currentBalance < cost) 的检查)
    // ... (因为这里的 currentBalance 是从 context 获取的，可能在预检后到实际扣费前被其他操作改变，虽然单次请求内不太可能，但保持严谨)

    let parsedMediaData: any;
    let parseSource: string;
    const cache = caches.default;
    const cacheKeyRequest = new Request(new URL(mediaUrl).toString(), { method: 'GET' });
    let cacheResponse = await cache.match(cacheKeyRequest);

    if (cacheResponse) {
      console.log(`[${endpointName}] Cache HIT for: ${mediaUrl}`);
      parsedMediaData = await cacheResponse.json();
      parseSource = 'cache';
    } else {
      // ... (调用第三方 API 的逻辑)
      console.log(`[${endpointName}] Cache MISS for: ${mediaUrl}. Fetching from API.`);
      const { DOUYIN_WTF_BASE_URL } = getEnv(c);
      const targetApiUrl = new URL('/api/hybrid/video_data', DOUYIN_WTF_BASE_URL);
      targetApiUrl.searchParams.set('url', mediaUrl);
      console.log(`[${endpointName}] Calling Douyin.wtf API: ${targetApiUrl.toString()}`);
      const headers = new Headers();
      if (c.env.DOUYIN_API_KEY) {
        headers.set('Authorization', `Bearer ${c.env.DOUYIN_API_KEY}`);
        console.log(`[${endpointName}] Using DOUYIN_API_KEY.`);
      }
      const apiResponse = await fetch(targetApiUrl.toString(), { headers });
      console.log(`[${endpointName}] Douyin.wtf API response status: ${apiResponse.status} for ${mediaUrl}`);

      if (!apiResponse.ok) {
        const errorText = await apiResponse.text();
        console.error(`[${endpointName}] Douyin.wtf API error for ${mediaUrl}: ${apiResponse.status}, Body: ${errorText}`);
        return c.json({ error: `解析媒体链接失败 (API Code: ${apiResponse.status})`, details: errorText }, 502);
      }
      const responseText = await apiResponse.text();
      try {
        parsedMediaData = JSON.parse(responseText);
        console.log(`[${endpointName}] Successfully parsed JSON response for ${mediaUrl}.`);
      } catch (jsonErr) {
        console.error(`[${endpointName}] Failed to parse JSON from Douyin.wtf API for ${mediaUrl}. Response text: ${responseText}`, jsonErr);
        return c.json({ error: '解析第三方API响应失败，非JSON格式', details: responseText }, 502);
      }
      parseSource = 'api';
      console.log(`[${endpointName}] Attempting to cache response for ${mediaUrl}`);
      const responseToCache = new Response(JSON.stringify(parsedMediaData), {
        status: apiResponse.status,
        statusText: apiResponse.statusText,
        headers: apiResponse.headers
      });
      responseToCache.headers.set('Cache-Control', 'public, max-age=900');
      c.executionCtx.waitUntil(cache.put(cacheKeyRequest, responseToCache));
      console.log(`[${endpointName}] Cache PUT initiated for ${mediaUrl}`);
    }

    // ... (提取 finalDownloadUrl, mediaTitle, mediaCover, extractedMediaType 的逻辑)
    // ... (再次检查 finalDownloadUrl 是否有效)
    // ... (最终的扣费逻辑，这里会再次检查 currentBalance，这是对的)
    const cost = 1;
    // currentBalance 应该从 c.get('balance') 重新获取，以防在长解析过程中被其他并发操作修改
    // 但对于单个 Worker 请求生命周期，它在 authMiddleware 设置后通常不变，除非此 API 内部修改了它再读取
    // 为了保险起见，可以重新获取一次，或者确保之前的 c.set('balance', newBalance) 没有在这个检查之前发生
    const balanceForFinalDeduct = c.get('balance'); // 或者就是用上面从 context 开始时获取的 currentBalance

    console.log(`[${endpointName}] Attempting to deduct cost: ${cost} for user ${userId} (balance: ${balanceForFinalDeduct}) for ${mediaUrl}`);
    if (balanceForFinalDeduct < cost) {
      // ... （返回402，附带parsedData等信息的逻辑）
    }
    // ... (执行扣费的 batch 操作)
    // ... (后续代码)
  } catch (err) {
    console.error(`[${endpointName}] Unexpected error in ${endpointName}:`, err);
    const msg = err instanceof Error ? err.message : '获取直接下载信息失败';
    return c.json({ error: msg, details: err instanceof Error ? err.stack : undefined }, 500);
  }
});

export default app;



