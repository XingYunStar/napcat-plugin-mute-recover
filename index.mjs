// index.mjs
import fs from 'fs';
import path from 'path';

// 事件类型定义
var EventType = /* @__PURE__ */ ((EventType2) => {
    EventType2["NOTICE"] = "notice";
    EventType2["MESSAGE"] = "message";
    return EventType2;
})(EventType || {});

// 插件启动时间
const startTime = Date.now();
let logger = null;

// 默认配置
let currentConfig = {
    enablePlugin: true,
    enableLogging: true,        // 是否记录详细日志
    enableAutoUnban: true,      // 是否启用自动恢复禁言
    bannedUsers: {},            // 存储被禁言用户信息 { "groupId_userId": { ... } }
    dataFilePath: "./banned_data.json"  // 数据存储文件路径
};

// 配置界面
let plugin_config_ui = [];

// 统计信息
const stats = {
    totalBans: 0,
    totalAutoUnbans: 0,
    totalManualUnbans: 0
};

// 禁言记录结构
// {
//   "groupId_userId": {
//     groupId: string,
//     userId: string,
//     firstBanBy: string,      // 第一次禁言人
//     firstBanTime: number,    // 第一次禁言时间戳
//     banDuration: number,     // 禁言时长（秒）
//     banEndTime: number,      // 禁言结束时间戳
//     isActive: boolean        // 是否仍在禁言中
//   }
// }

// 插件初始化
const plugin_init = async (ctx) => {
    logger = ctx.logger;
    logger.info("禁言监控插件 v1.0.0 已初始化");
    logger.info("作者：星陨");

    // 构建配置界面
    plugin_config_ui = ctx.NapCatConfig.combine(
        ctx.NapCatConfig.html('<div style="padding: 10px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 8px; color: white;"><h3>🔨 禁言监控插件</h3><p>监控群内禁言事件，记录禁言信息，并在特定条件下自动恢复禁言时长。</p><p><strong>作者：星陨</strong> | 版本：1.0.0</p></div>'),
        
        ctx.NapCatConfig.boolean("enablePlugin", "启用插件", true, "是否启用禁言监控功能"),
        ctx.NapCatConfig.boolean("enableLogging", "详细日志", true, "是否记录详细操作日志"),
        ctx.NapCatConfig.boolean("enableAutoUnban", "自动恢复禁言", true, "是否在条件满足时自动恢复禁言时长"),
        ctx.NapCatConfig.text("dataFilePath", "数据文件路径", "./banned_data.json", "存储禁言记录的文件路径")
    );

    // 加载配置
    try {
        if (fs.existsSync(ctx.configPath)) {
            const savedConfig = JSON.parse(fs.readFileSync(ctx.configPath, "utf-8"));
            Object.assign(currentConfig, savedConfig);
            logger.info("配置已加载");
        }
    } catch (e) {
        logger?.warn("加载配置失败，使用默认配置", e);
    }

    // 加载禁言数据
    await loadBannedData();

    logger.info("禁言监控插件启动完成");
};

// 加载禁言数据
async function loadBannedData() {
    try {
        if (fs.existsSync(currentConfig.dataFilePath)) {
            const data = JSON.parse(fs.readFileSync(currentConfig.dataFilePath, "utf-8"));
            currentConfig.bannedUsers = data.bannedUsers || {};
            stats.totalBans = data.totalBans || 0;
            stats.totalAutoUnbans = data.totalAutoUnbans || 0;
            stats.totalManualUnbans = data.totalManualUnbans || 0;
            logger?.info(`已加载禁言数据，当前监控 ${Object.keys(currentConfig.bannedUsers).length} 条禁言记录`);
        }
    } catch (e) {
        logger?.warn("加载禁言数据失败", e);
        currentConfig.bannedUsers = {};
    }
}

// 保存禁言数据
async function saveBannedData() {
    try {
        const data = {
            bannedUsers: currentConfig.bannedUsers,
            totalBans: stats.totalBans,
            totalAutoUnbans: stats.totalAutoUnbans,
            totalManualUnbans: stats.totalManualUnbans,
            lastUpdate: new Date().toISOString()
        };
        
        const dataDir = path.dirname(currentConfig.dataFilePath);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        
        fs.writeFileSync(currentConfig.dataFilePath, JSON.stringify(data, null, 2), "utf-8");
        
        if (currentConfig.enableLogging) {
            logger?.info(`禁言数据已保存`);
        }
    } catch (e) {
        logger?.error("保存禁言数据失败", e);
    }
}

// 获取剩余禁言时长（秒）
function getRemainingBanTime(banEndTime) {
    const now = Date.now();
    const remaining = Math.max(0, Math.floor((banEndTime - now) / 1000));
    return remaining;
}

// 恢复禁言（解除禁言）
async function unbanUser(ctx, groupId, userId, reason) {
    try {
        const key = `${groupId}_${userId}`;
        const record = currentConfig.bannedUsers[key];
        
        if (!record || !record.isActive) {
            logger?.info(`用户 ${userId} 不在禁言记录中或已解除禁言`);
            return false;
        }
        
        const remaining = getRemainingBanTime(record.banEndTime);
        
        if (remaining <= 0) {
            // 禁言已自然结束
            delete currentConfig.bannedUsers[key];
            await saveBannedData();
            logger?.info(`用户 ${userId} 的禁言已自然结束，移除记录`);
            return false;
        }
        
        // 调用API解除禁言
        await ctx.actions.call(
            "set_group_ban",
            {
                group_id: groupId,
                user_id: userId,
                duration: 0  // 0 表示解除禁言
            },
            ctx.adapterName,
            ctx.pluginManager.config
        );
        
        // 更新记录
        record.isActive = false;
        await saveBannedData();
        
        stats.totalAutoUnbans++;
        
        logger?.info(`✅ 已自动恢复用户 ${userId} 的剩余禁言时长 ${remaining} 秒，原因: ${reason}`);
        
        // 可选：发送通知消息
        try {
            await ctx.actions.call(
                "send_group_msg",
                {
                    group_id: groupId,
                    message: `🔓 用户 ${userId} 的禁言已提前解除（剩余 ${formatDuration(remaining)}），原因: ${reason}`
                },
                ctx.adapterName,
                ctx.pluginManager.config
            );
        } catch (msgError) {
            // 忽略发送消息失败
        }
        
        return true;
        
    } catch (error) {
        logger?.error(`恢复禁言失败: ${error.message}`);
        return false;
    }
}

// 格式化时长显示
function formatDuration(seconds) {
    if (seconds < 60) return `${seconds}秒`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}分钟${seconds % 60}秒`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}小时${Math.floor((seconds % 3600) / 60)}分钟`;
    return `${Math.floor(seconds / 86400)}天${Math.floor((seconds % 86400) / 3600)}小时`;
}

// 检查并清理已过期的禁言记录
async function cleanupExpiredBans() {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [key, record] of Object.entries(currentConfig.bannedUsers)) {
        if (record.banEndTime <= now) {
            delete currentConfig.bannedUsers[key];
            cleaned++;
        }
    }
    
    if (cleaned > 0) {
        await saveBannedData();
        if (currentConfig.enableLogging) {
            logger?.info(`已清理 ${cleaned} 条过期禁言记录`);
        }
    }
}

// 处理禁言事件
const plugin_onevent = async (ctx, event) => {
    if (!currentConfig.enablePlugin) return;
    
    // 只处理通知事件
    if (event.post_type !== EventType.NOTICE) return;
    
    // 处理群禁言事件
    if (event.notice_type === 'group_ban') {
        const groupId = event.group_id;
        const userId = event.user_id;
        const operatorId = event.operator_id;
        const duration = event.duration; // 禁言时长（秒），0表示解除禁言
        
        const key = `${groupId}_${userId}`;
        
        if (duration > 0) {
            // 禁言操作
            if (!currentConfig.bannedUsers[key]) {
                // 首次禁言
                const banEndTime = Date.now() + (duration * 1000);
                
                currentConfig.bannedUsers[key] = {
                    groupId: groupId,
                    userId: userId,
                    firstBanBy: operatorId,
                    firstBanTime: Date.now(),
                    banDuration: duration,
                    banEndTime: banEndTime,
                    isActive: true
                };
                
                stats.totalBans++;
                await saveBannedData();
                
                if (currentConfig.enableLogging) {
                    logger?.info(`📝 记录禁言: 群 ${groupId}, 用户 ${userId}, 时长 ${duration}秒, 操作人 ${operatorId}`);
                }
                
                // 检查是否需要在30分钟后发送提醒
                setTimeout(async () => {
                    const record = currentConfig.bannedUsers[key];
                    if (record && record.isActive) {
                        const remaining = getRemainingBanTime(record.banEndTime);
                        if (remaining > 0) {
                            try {
                                await ctx.actions.call(
                                    "send_group_msg",
                                    {
                                        group_id: groupId,
                                        message: `⏰ 提醒: 用户 ${userId} 被禁言，剩余时长 ${formatDuration(remaining)}`
                                    },
                                    ctx.adapterName,
                                    ctx.pluginManager.config
                                );
                            } catch (e) {
                                // 忽略
                            }
                        }
                    }
                }, 30 * 60 * 1000); // 30分钟后提醒
                
            } else {
                // 更新禁言记录（追加禁言）
                const record = currentConfig.bannedUsers[key];
                const newEndTime = Math.max(record.banEndTime, Date.now()) + (duration * 1000);
                record.banEndTime = newEndTime;
                record.banDuration = Math.floor((newEndTime - record.firstBanTime) / 1000);
                await saveBannedData();
                
                if (currentConfig.enableLogging) {
                    logger?.info(`📝 更新禁言: 群 ${groupId}, 用户 ${userId}, 追加 ${duration}秒, 总时长 ${record.banDuration}秒`);
                }
            }
            
        } else if (duration === 0) {
            // 解除禁言操作
            const record = currentConfig.bannedUsers[key];
            
            if (record && record.isActive) {
                const remaining = getRemainingBanTime(record.banEndTime);
                
                if (remaining > 0) {
                    // 提前解除禁言
                    stats.totalManualUnbans++;
                    
                    if (currentConfig.enableAutoUnban) {
                        // 条件1: 检查解除禁言的人是否为第一次禁言人
                        if (operatorId !== record.firstBanBy) {
                            logger?.info(`⚠️ 检测到提前解除禁言: 用户 ${userId}, 解除人 ${operatorId}, 第一次禁言人 ${record.firstBanBy}`);
                            
                            // 恢复剩余禁言时长
                            await unbanUser(ctx, groupId, userId, "解除禁言人不是第一次禁言人");
                        } else {
                            // 第一次禁言人解除，正常处理
                            delete currentConfig.bannedUsers[key];
                            await saveBannedData();
                            
                            if (currentConfig.enableLogging) {
                                logger?.info(`✅ 用户 ${userId} 的禁言已由第一次禁言人 ${operatorId} 解除`);
                            }
                        }
                    } else {
                        // 不启用自动恢复，直接删除记录
                        delete currentConfig.bannedUsers[key];
                        await saveBannedData();
                    }
                } else {
                    // 禁言已过期，删除记录
                    delete currentConfig.bannedUsers[key];
                    await saveBannedData();
                }
            } else {
                // 没有记录，可能是手动解除没有记录的禁言
                if (currentConfig.enableLogging) {
                    logger?.info(`用户 ${userId} 解除禁言，但无相关记录`);
                }
            }
        }
    }
};

// 处理消息事件（用于检测被禁言者发言）
const plugin_onmessage = async (ctx, event) => {
    if (!currentConfig.enablePlugin || !currentConfig.enableAutoUnban) return;
    
    // 只处理群消息
    if (event.post_type !== EventType.MESSAGE) return;
    if (event.message_type !== 'group') return;
    
    const groupId = event.group_id;
    const userId = event.user_id;
    const key = `${groupId}_${userId}`;
    
    const record = currentConfig.bannedUsers[key];
    
    // 条件3: 被禁言者发言时，恢复剩余禁言时长
    if (record && record.isActive) {
        const remaining = getRemainingBanTime(record.banEndTime);
        
        if (remaining > 0) {
            logger?.info(`🔊 检测到被禁言用户 ${userId} 发言（这不科学！），恢复剩余禁言时长 ${formatDuration(remaining)}`);
            await unbanUser(ctx, groupId, userId, "被禁言者发言（自动检测）");
        } else {
            // 禁言已过期，清理记录
            delete currentConfig.bannedUsers[key];
            await saveBannedData();
        }
    }
};

// 处理群成员加入事件
const plugin_onnotice = async (ctx, event) => {
    if (!currentConfig.enablePlugin || !currentConfig.enableAutoUnban) return;
    
    // 处理群成员增加事件
    if (event.notice_type === 'group_increase') {
        const groupId = event.group_id;
        const userId = event.user_id;
        const key = `${groupId}_${userId}`;
        
        const record = currentConfig.bannedUsers[key];
        
        // 条件2: 被禁言者加入群聊时，恢复剩余禁言时长
        if (record && record.isActive) {
            const remaining = getRemainingBanTime(record.banEndTime);
            
            if (remaining > 0) {
                logger?.info(`👋 检测到被禁言用户 ${userId} 重新加入群聊，恢复剩余禁言时长 ${formatDuration(remaining)}`);
                await unbanUser(ctx, groupId, userId, "重新加入群聊");
            } else {
                // 禁言已过期，清理记录
                delete currentConfig.bannedUsers[key];
                await saveBannedData();
            }
        }
    }
};

// 定时清理过期记录（每5分钟）
setInterval(async () => {
    if (currentConfig.enablePlugin) {
        await cleanupExpiredBans();
    }
}, 5 * 60 * 1000);

// 获取插件配置
const plugin_get_config = async () => {
    return currentConfig;
};

// 设置插件配置
const plugin_set_config = async (ctx, config) => {
    Object.assign(currentConfig, config);
    
    if (ctx && ctx.configPath) {
        try {
            const configDir = path.dirname(ctx.configPath);
            if (!fs.existsSync(configDir)) {
                fs.mkdirSync(configDir, { recursive: true });
            }
            fs.writeFileSync(ctx.configPath, JSON.stringify(currentConfig, null, 2), "utf-8");
            logger?.info("配置保存成功");
        } catch (e) {
            logger?.error("保存配置失败", e);
            throw e;
        }
    }
};

// 配置控制器
const plugin_config_controller = async (_ctx, ui, initialConfig) => {
    logger?.info("配置控制器已初始化");
    return () => {
        logger?.info("配置控制器已清理");
    };
};

// 配置变更处理
const plugin_on_config_change = async (_ctx, ui, key, value, _currentConfig) => {
    logger?.info(`配置字段变化: ${key} = ${value}`);
};

// 导出插件接口
export { 
    plugin_config_ui,
    plugin_init,
    plugin_onevent,
    plugin_onmessage,
    plugin_onnotice,
    plugin_get_config,
    plugin_set_config,
    plugin_config_controller,
    plugin_on_config_change
};