-- 用户表
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,                -- Logto User ID (sub)
  email TEXT UNIQUE,                  -- 用户邮箱
  name TEXT,                          -- 用户名
  is_member BOOLEAN DEFAULT FALSE,      -- 可选：标识是否为特定会员，用于默认赠送
  first_recharge_completed BOOLEAN DEFAULT FALSE, -- 标识是否已完成首充
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, -- 创建时间
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP  -- 更新时间
);

-- 余额/次数表
CREATE TABLE IF NOT EXISTS balances (
  user_id TEXT PRIMARY KEY REFERENCES users(id), -- 关联用户表
  balance INTEGER DEFAULT 0,                     -- 余额或次数 (如果希望新用户默认为1，可在此处设为1，或在authMiddleware中处理)
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP  -- 最后更新时间
);

-- 订单表
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,                           -- 订单ID (可使用UUID或支付商订单号)
  user_id TEXT NOT NULL REFERENCES users(id),    -- 关联用户表
  type TEXT NOT NULL,                            -- 订单类型 (e.g., 'RECHARGE', 'USAGE_FEE', 'INVITE_REWARD')
  amount INTEGER NOT NULL,                       -- 订单金额或次数 (正负表示增减)
  status TEXT NOT NULL,                          -- 订单状态 ('PENDING', 'SUCCESS', 'FAILED')
  payment_provider_order_id TEXT UNIQUE,         -- 支付服务商订单号 (可选, 充值时用)
  related_item_url TEXT,                       -- 关联项目URL (例如，处理的图片/视频链接)
  used_invitation_code TEXT NULL,              -- 充值或注册时使用的邀请码 (可选)
  metadata TEXT,                               -- 额外元数据 (JSON 字符串)
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, -- 创建时间
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP  -- 更新时间
);

-- 邀请码表
CREATE TABLE IF NOT EXISTS invitation_codes (
  code TEXT PRIMARY KEY,                                  -- 邀请码
  issuer_user_id TEXT NOT NULL REFERENCES users(id),      -- 邀请码发放者/邀请人
  max_uses INTEGER DEFAULT 1,                             -- 可被使用的最大次数
  uses_count INTEGER DEFAULT 0,                           -- 已被使用的次数
  reward_for_issuer INTEGER DEFAULT 1,                    -- 给邀请人的奖励次数
  reward_for_invitee INTEGER DEFAULT 1,                   -- 给被邀请人的奖励次数 (例如用于注册奖励)
  is_active BOOLEAN DEFAULT TRUE,                         -- 是否激活
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,          -- 创建时间
  expires_at TIMESTAMP NULL                               -- 过期时间 (可选)
);

-- 可选：创建索引以优化查询
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders (user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status);
CREATE INDEX IF NOT EXISTS idx_balances_user_id ON balances (user_id);
CREATE INDEX IF NOT EXISTS idx_invitation_codes_issuer_id ON invitation_codes (issuer_user_id); 