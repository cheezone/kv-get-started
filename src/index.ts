export interface Env {
  USER_NOTIFICATION: KVNamespace;
}

import type { UserInfoResponse } from '@logto/node';

const logtoEndpoint = 'https://es50q2.logto.app'; // 替换为您的 Logto 端点
const userInfoEndpoint = `${logtoEndpoint}/oidc/me`;

const getUserInfo = async (request: Request): Promise<UserInfoResponse> => {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw new Error('无效的授权请求头'); // 中文注释
  }

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

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      const url = new URL(request.url);

    if (url.pathname.startsWith('/v1/')) {
      let userInfo: UserInfoResponse;
      try {
        userInfo = await getUserInfo(request);
      } catch (err) {
        console.error('令牌验证或用户信息获取错误:', err); // 中文注释
        const message = err instanceof Error ? err.message : '未知的认证错误';
        if (message === '无效的授权请求头' || message === '获取用户信息失败') { // 匹配中文错误信息
          return new Response(message, { status: 401, headers: { "Content-Type": "text/plain; charset=utf-8" } });
        }
        return new Response('令牌验证或用户信息获取过程中发生错误。', { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } });
      }

      // 令牌有效，用户信息已获取
      if (url.pathname === '/v1/tikpic') {
        let tikpicCount = 0; // 默认返回 0
        const customData = userInfo.custom_data as Record<string, any> | undefined;

        if (customData && typeof customData.tikpic_count === 'number') {
          tikpicCount = customData.tikpic_count;
        }
        // 直接返回数字，内容类型为 text/plain
        return new Response(tikpicCount.toString(), {
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      } else {
        // 对于其他 /v1/* 路径，返回完整的用户信息
        return new Response(JSON.stringify(userInfo), {
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        });
      }
    } else if (url.pathname === '/v1/kv-example') {
      // KV 存储示例
      try {
        await env.USER_NOTIFICATION.put("user_kv_example", "KV 存储功能正常！"); // 中文示例值
        const value = await env.USER_NOTIFICATION.get("user_kv_example");
        if (value === null) {
          return new Response("写入KV后未找到值！", { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } });
        }
        return new Response(`KV 示例：获取到的值: '${value}'`, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
      } catch (err) {
        console.error(`KV 操作返回错误:`, err); // 中文注释
        const errorMessage =
          err instanceof Error
            ? err.message
            : "访问KV存储时发生未知错误"; // 中文注释
        return new Response(errorMessage, {
          status: 500,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }
    } else if (url.pathname === '/') {
      return new Response("欢迎！这是根路径。API 端点位于 /v1/ 之下。", { // 中文欢迎信息
        status: 200, 
        headers: { "Content-Type": "text/plain; charset=utf-8" } 
      });
    }

    return new Response("未找到。请求的资源不存在。", { // 中文404信息
      status: 404, 
      headers: { "Content-Type": "text/plain; charset=utf-8" } 
    });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '验证令牌时发生未知错误';
      return new Response(errorMessage, { 
        status: 500, 
        headers: { "Content-Type": "text/plain; charset=utf-8" } 
      });
    }
  },
} satisfies ExportedHandler<Env>;
