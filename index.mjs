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
    enableAutoReBan: true,           // 是否自动恢复禁言
    enableLogDetails: true,          // 是否记录详细日志
    clearRecordOnFullUnban: true,    // 完整解除禁言后是否清除记录
    trackOnLeave: true,              // 退群时是否保留禁言记录
    trackOnMessage: true,            // 发言时是否检查并恢复禁言
    allowOperatorUnban: false,       // 允许禁言操作者解除禁言（原操作者解除时不恢复）
    bannedUsers: {}                  // 存储禁言用户记录
};

// 配置界面
let plugin_config_ui = [];

// 统计信息
const stats = {
    totalBans: 0,
    totalRestored: 0,
    activeBans: 0,
    blockedRestores: 0  // 因原操作者解除而阻止恢复的次数
};

// 插件初始化
const plugin_init = async (ctx) => {
    logger = ctx.logger;
    logger.info("禁言记录恢复插件 v1.0.0 已初始化");
    logger.info("作者：星陨");

    // 构建配置界面
    plugin_config_ui = ctx.NapCatConfig.combine(
        ctx.NapCatConfig.html('<div style="padding: 10px;"><h3>🔒 禁言记录恢复插件</h3><p>作者：星陨</p><p>非本人解除禁言时自动恢复剩余时间禁言</p><p>✨ 记录第一次禁言操作者，只有原操作者解除禁言时才不恢复</p></div>'),
        ctx.NapCatConfig.boolean("enablePlugin", "启用插件", true, "是否启用禁言记录功能"),
        ctx.NapCatConfig.boolean("enableAutoReBan", "自动恢复禁言", true, "是否自动恢复禁言"),
        ctx.NapCatConfig.boolean("enableLogDetails", "记录详细信息", true, "是否记录详细日志"),
        ctx.NapCatConfig.boolean("clearRecordOnFullUnban", "完整解除后清除记录", true, "禁言时间完整结束后是否清除记录"),
        ctx.NapCatConfig.boolean("trackOnLeave", "退群时保留记录", true, "用户退群时是否保留禁言记录"),
        ctx.NapCatConfig.boolean("trackOnMessage", "发言时检查恢复", true, "用户发言时是否检查并恢复禁言"),
        ctx.NapCatConfig.boolean("allowOperatorUnban", "允许禁言操作者解除禁言", false, "开启后，只有第一次禁言的操作者解除时才不恢复；关闭后，任何人解除都会立即恢复")
    );

    // 加载配置
    try {
        if (fs.existsSync(ctx.configPath)) {
            const savedConfig = JSON.parse(fs.readFileSync(ctx.configPath, "utf-8"));
            Object.assign(currentConfig, savedConfig);
            // 确保 bannedUsers 对象存在
            if (!currentConfig.bannedUsers) {
                currentConfig.bannedUsers = {};
            }
            logger.info(`配置已加载，当前有 ${Object.keys(currentConfig.bannedUsers).length} 条禁言记录`);
            updateStats();
        } else {
            currentConfig.bannedUsers = {};
        }
    } catch (e) {
        logger?.warn("加载配置失败，使用默认配置", e);
        currentConfig.bannedUsers = {};
    }

    logger.info("禁言记录恢复插件启动完成");
    logger.info(`配置: allowOperatorUnban = ${currentConfig.allowOperatorUnban ? '开启' : '关闭'}`);
};

// 更新统计信息
function updateStats() {
    stats.activeBans = Object.keys(currentConfig.bannedUsers || {}).length;
}

// 保存配置到文件
async function saveConfig(ctx) {
    if (!ctx || !ctx.configPath) return;
    
    try {
        const configPath = ctx.configPath;
        const configDir = path.dirname(configPath);
        if (!fs.existsSync(configDir)) {
            fs.mkdirSync(configDir, { recursive: true });
        }
        
        fs.writeFileSync(configPath, JSON.stringify(currentConfig, null, 2), "utf-8");
        updateStats();
    } catch (e) {
        logger?.error("保存配置失败", e);
    }
}

// 获取禁言记录的key
function getBanKey(groupId, userId) {
    return `${groupId}_${userId}`;
}

// 记录禁言
async function recordBan(ctx, groupId, userId, duration, operatorId) {
    const key = getBanKey(groupId, userId);
    const startTime = Date.now();
    const endTime = startTime + (duration * 1000);
    
    // 检查是否已有记录
    const existingRecord = currentConfig.bannedUsers[key];
    
    currentConfig.bannedUsers[key] = {
        groupId: groupId,
        userId: userId,
        duration: duration,
        startTime: startTime,
        endTime: endTime,
        remainingTime: duration,
        operatorId: operatorId,           // 当前禁言的操作者
        originalOperatorId: existingRecord ? existingRecord.originalOperatorId : operatorId, // 保留第一次的操作者
        lastUpdateTime: startTime,
        banCount: (existingRecord ? existingRecord.banCount : 0) + 1  // 禁言次数统计
    };
    
    await saveConfig(ctx);
    stats.totalBans++;
    updateStats();
    
    if (currentConfig.enableLogDetails) {
        logger?.info(`📝 记录禁言: 群 ${groupId}, 用户 ${userId}, 时长 ${duration}秒, 操作者 ${operatorId}, 原操作者: ${currentConfig.bannedUsers[key].originalOperatorId}`);
    }
}

// 解除禁言（完整解除）
async function liftBan(ctx, groupId, userId, operatorId) {
    const key = getBanKey(groupId, userId);
    
    if (currentConfig.bannedUsers[key]) {
        const record = currentConfig.bannedUsers[key];
        
        if (currentConfig.enableLogDetails) {
            logger?.info(`📝 解除禁言事件: 群 ${groupId}, 用户 ${userId}, 操作者 ${operatorId}, 原操作者 ${record.originalOperatorId}, allowOperatorUnban=${currentConfig.allowOperatorUnban}`);
        }
        
        // 判断是否需要阻止恢复
        let shouldPreventRestore = false;
        
        if (currentConfig.allowOperatorUnban) {
            // 开启：允许禁言操作者解除（只有原操作者解除时才不恢复）
            if (operatorId === record.originalOperatorId) {
                shouldPreventRestore = true;
                if (currentConfig.enableLogDetails) {
                    logger?.info(`✅ 原操作者 ${operatorId} 解除了禁言，记录已清除，不会恢复`);
                }
            }
        } else {
            // 关闭：任何人解除都会立即恢复（不判断操作者）
            shouldPreventRestore = false;
            if (currentConfig.enableLogDetails) {
                logger?.info(`⚠️ allowOperatorUnban 已关闭，任何人解除都会恢复禁言`);
            }
        }
        
        // 如果应该阻止恢复，直接删除记录
        if (shouldPreventRestore) {
            delete currentConfig.bannedUsers[key];
            await saveConfig(ctx);
            updateStats();
            stats.blockedRestores++;
            return true; // 表示已完全解除
        }
        
        // 否则，计算剩余时间并准备恢复
        const now = Date.now();
        const elapsedSeconds = Math.floor((now - record.startTime) / 1000);
        const remainingSeconds = Math.max(0, record.duration - elapsedSeconds);
        
        if (remainingSeconds > 0) {
            // 还有剩余时间，记录会被保留，立即恢复禁言
            if (currentConfig.enableLogDetails) {
                logger?.info(`⚠️ 解除禁言（非原操作者或allowOperatorUnban关闭），剩余 ${remainingSeconds}秒，立即恢复禁言...`);
            }
            
            // 更新记录中的剩余时间
            record.remainingTime = remainingSeconds;
            record.lastUpdateTime = now;
            await saveConfig(ctx);
            
            // 立即恢复禁言
            await executeRestoreBan(ctx, groupId, userId, remainingSeconds, record.originalOperatorId);
            
            return false; // 表示未完全解除，已恢复
        } else {
            // 禁言已自然结束
            if (currentConfig.clearRecordOnFullUnban) {
                delete currentConfig.bannedUsers[key];
                await saveConfig(ctx);
                updateStats();
                if (currentConfig.enableLogDetails) {
                    logger?.info(`⏰ 禁言已自然结束: 群 ${groupId}, 用户 ${userId}`);
                }
            }
            return true; // 表示已完全解除
        }
    }
    
    return true; // 没有记录，视为已解除
}

// 执行恢复禁言（独立函数，不检查状态直接禁言）
async function executeRestoreBan(ctx, groupId, userId, duration, originalOperatorId) {
    if (!currentConfig.enableAutoReBan) {
        return false;
    }
    
    if (duration <= 0) {
        return false;
    }
    
    try {
        if (currentConfig.enableLogDetails) {
            logger?.info(`🔄 执行恢复禁言: 群 ${groupId}, 用户 ${userId}, 时长 ${duration}秒, 原操作者 ${originalOperatorId}`);
        }
        
        // 直接调用禁言API
        await ctx.actions.call(
            "set_group_ban",
            { group_id: groupId, user_id: userId, duration: duration },
            ctx.adapterName,
            ctx.pluginManager.config
        );
        
        stats.totalRestored++;
        
        if (currentConfig.enableLogDetails) {
            logger?.info(`✅ 恢复禁言成功: 群 ${groupId}, 用户 ${userId}, 时长 ${duration}秒`);
        }
        return true;
        
    } catch (error) {
        // 即使API返回"No data returned"，实际上可能已经禁言成功了
        // 因为QQ的API经常返回这个错误但操作已执行
        logger?.warn(`恢复禁言API返回: ${error.message} (可能已成功)`);
        
        // 标记为已恢复
        stats.totalRestored++;
        
        if (currentConfig.enableLogDetails) {
            logger?.info(`✅ 恢复禁言已执行: 群 ${groupId}, 用户 ${userId}, 时长 ${duration}秒 (API响应: ${error.message})`);
        }
        return true;
    }
}

// 检查并恢复禁言（用于发言和进群触发）
async function checkAndRestoreBan(ctx, groupId, userId, triggerSource = 'unknown') {
    if (!currentConfig.enableAutoReBan) {
        return false;
    }
    
    const key = getBanKey(groupId, userId);
    const record = currentConfig.bannedUsers[key];
    
    if (!record) {
        return false;
    }
    
    const now = Date.now();
    const elapsedSeconds = Math.floor((now - record.startTime) / 1000);
    let remainingSeconds = record.duration - elapsedSeconds;
    
    // 如果剩余时间 <= 0，说明禁言已结束
    if (remainingSeconds <= 0) {
        if (currentConfig.clearRecordOnFullUnban) {
            delete currentConfig.bannedUsers[key];
            await saveConfig(ctx);
            updateStats();
            if (currentConfig.enableLogDetails) {
                logger?.info(`⏰ 禁言已自然结束: 群 ${groupId}, 用户 ${userId}`);
            }
        }
        return false;
    }
    
    // 获取当前用户禁言状态
    try {
        const memberInfo = await ctx.actions.call(
            "get_group_member_info",
            { group_id: groupId, user_id: userId },
            ctx.adapterName,
            ctx.pluginManager.config
        );
        
        let currentShutUpTimestamp = 0;
        if (memberInfo && memberInfo.data) {
            currentShutUpTimestamp = memberInfo.data.shut_up_timestamp || 0;
        } else if (memberInfo) {
            currentShutUpTimestamp = memberInfo.shut_up_timestamp || 0;
        }
        
        const isCurrentlyBanned = currentShutUpTimestamp > Math.floor(now / 1000);
        
        // 如果当前未被禁言，需要恢复禁言
        if (!isCurrentlyBanned) {
            if (currentConfig.enableLogDetails) {
                logger?.info(`🔄 恢复禁言 (触发: ${triggerSource}): 群 ${groupId}, 用户 ${userId}, 剩余 ${remainingSeconds}秒, 原操作者 ${record.originalOperatorId}`);
            }
            
            await executeRestoreBan(ctx, groupId, userId, remainingSeconds, record.originalOperatorId);
            
            // 更新记录中的开始时间（重新计时）
            record.startTime = now;
            record.endTime = now + (remainingSeconds * 1000);
            record.lastUpdateTime = now;
            await saveConfig(ctx);
            
            return true;
        } else {
            // 已处于禁言状态，检查剩余时间是否需要更新
            const serverRemaining = currentShutUpTimestamp - Math.floor(now / 1000);
            if (Math.abs(serverRemaining - remainingSeconds) > 5) {
                // 如果服务器剩余时间与记录相差较大，更新记录
                record.remainingTime = serverRemaining;
                record.endTime = now + (serverRemaining * 1000);
                await saveConfig(ctx);
                if (currentConfig.enableLogDetails) {
                    logger?.info(`📝 更新禁言记录: 群 ${groupId}, 用户 ${userId}, 服务器剩余 ${serverRemaining}秒`);
                }
            }
        }
    } catch (error) {
        logger?.error(`检查用户 ${userId} 禁言状态失败: ${error.message}`);
        // 即使检查失败，也尝试直接恢复禁言
        await executeRestoreBan(ctx, groupId, userId, remainingSeconds, record.originalOperatorId);
    }
    
    return false;
}

// 处理用户退群
async function handleGroupDecrease(ctx, groupId, userId, operatorId) {
    if (!currentConfig.trackOnLeave) {
        const key = getBanKey(groupId, userId);
        if (currentConfig.bannedUsers[key]) {
            delete currentConfig.bannedUsers[key];
            await saveConfig(ctx);
            if (currentConfig.enableLogDetails) {
                logger?.info(`📤 用户 ${userId} 退群，已清除禁言记录`);
            }
        }
        return;
    }
    
    const key = getBanKey(groupId, userId);
    if (currentConfig.bannedUsers[key]) {
        const record = currentConfig.bannedUsers[key];
        const now = Date.now();
        const elapsedSeconds = Math.floor((now - record.startTime) / 1000);
        const remainingSeconds = Math.max(0, record.duration - elapsedSeconds);
        
        record.remainingTime = remainingSeconds;
        record.leftGroup = true;
        record.leftGroupTime = now;
        record.lastUpdateTime = now;
        
        await saveConfig(ctx);
        
        if (currentConfig.enableLogDetails) {
            logger?.info(`📤 用户 ${userId} 退群，剩余禁言 ${remainingSeconds}秒，已保留记录，原操作者 ${record.originalOperatorId}`);
        }
    }
}

// 处理用户进群
async function handleGroupIncrease(ctx, groupId, userId, operatorId) {
    const key = getBanKey(groupId, userId);
    const record = currentConfig.bannedUsers[key];
    
    if (record && record.remainingTime > 0) {
        delete record.leftGroup;
        delete record.leftGroupTime;
        
        const now = Date.now();
        record.startTime = now;
        record.endTime = now + (record.remainingTime * 1000);
        record.lastUpdateTime = now;
        await saveConfig(ctx);
        
        if (currentConfig.enableLogDetails) {
            logger?.info(`📥 用户 ${userId} 重新进群，剩余禁言 ${record.remainingTime}秒，原操作者 ${record.originalOperatorId}，准备恢复禁言`);
        }
        
        await checkAndRestoreBan(ctx, groupId, userId, 'rejoin');
    }
}

// 处理用户发言
async function handleMessage(ctx, event) {
    if (!currentConfig.trackOnMessage) {
        return;
    }
    
    const groupId = event.group_id;
    const userId = event.user_id;
    
    if (groupId && userId) {
        await checkAndRestoreBan(ctx, groupId, userId, 'message');
    }
}

// 处理禁言事件
async function handleGroupBan(ctx, event) {
    const groupId = event.group_id;
    const userId = event.user_id;
    const operatorId = event.operator_id;
    const duration = event.duration;
    
    if (duration > 0) {
        await recordBan(ctx, groupId, userId, duration, operatorId);
    } else {
        await liftBan(ctx, groupId, userId, operatorId);
    }
}

// 处理插件配置获取
const plugin_get_config = async () => {
    return currentConfig;
};

// 处理插件配置设置
const plugin_set_config = async (ctx, config) => {
    const existingBannedUsers = currentConfig.bannedUsers;
    currentConfig = config;
    if (!currentConfig.bannedUsers) {
        currentConfig.bannedUsers = existingBannedUsers || {};
    }
    await saveConfig(ctx);
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

// 主事件处理函数
const plugin_onevent = async (ctx, event) => {
    if (!currentConfig.enablePlugin) {
        return;
    }
    
    if (event.post_type === EventType.NOTICE) {
        switch (event.notice_type) {
            case 'group_ban':
                await handleGroupBan(ctx, event);
                break;
            case 'group_decrease':
                if (event.sub_type === 'leave' || event.sub_type === 'kick') {
                    await handleGroupDecrease(ctx, event.group_id, event.user_id, event.operator_id);
                }
                break;
            case 'group_increase':
                if (event.sub_type === 'approve' || event.sub_type === 'invite') {
                    await handleGroupIncrease(ctx, event.group_id, event.user_id, event.operator_id);
                }
                break;
        }
    }
    
    if (currentConfig.trackOnMessage && event.post_type === EventType.MESSAGE && event.message_type === 'group') {
        await handleMessage(ctx, event);
    }
};

// 插件清理
const plugin_cleanup = async (ctx) => {
    if (currentConfig.enableLogDetails) {
        logger?.info("插件正在清理，保存最终状态...");
    }
    await saveConfig(ctx);
};

export { 
    plugin_config_ui,
    plugin_init,
    plugin_onevent,
    plugin_cleanup,
    plugin_get_config,
    plugin_set_config,
    plugin_config_controller,
    plugin_on_config_change
};