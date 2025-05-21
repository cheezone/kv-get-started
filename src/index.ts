import { Hono } from 'hono';

export interface Env {
  USER_NOTIFICATION: KVNamespace;
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

export default app;
