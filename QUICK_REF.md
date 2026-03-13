# KY001 快速参考

## 🎯 一键命令

### 查看版本信息
```bash
cat KY001_VERSION.md
```

### 备份当前版本
```bash
./backup-ky001.sh backup
```

### 恢复到 KY001
```bash
./backup-ky001.sh restore && coze dev
```

### 验证功能
```bash
curl -s -X POST -H 'Content-Type: application/json' -d '{"text":"我是真千金但你们才是假豪门-第1集\n这是正文内容第一段","maxChars":12,"baomuPrefix":"我是真千金但你们才是假豪门-第1集"}' http://localhost:5000/api/process | tail -3
```

## 📋 版本状态

**KY001** - ✅ 稳定可用版
- 创建时间：2025-01-14
- 状态：已验证，功能正常
- 位置：/workspace/projects/backup/KY001/

## 🔥 核心功能

| 功能 | 状态 | 说明 |
|------|------|------|
| 删除报幕 | ✅ | 支持多种格式，自动容错 |
| 标点断行 | ✅ | 自动拆分，删除标点 |
| LLM 拆分 | ✅ | 语义拆分，保持完整性 |
| 流式响应 | ✅ | 实时进度显示 |
| 取消功能 | ✅ | 随时中断处理 |
| 拖拽上传 | ✅ | 支持文件拖拽 |
| 复制下载 | ✅ | 便捷导出功能 |

## 🎨 支持的报幕格式

```
剧名-第1集      ✅
剧名-EP1        ✅
剧名-Season1    ✅
剧名-1          ✅
剧名 - 第1集    ✅ (自动容错)
```

## 📁 关键文件

```
/workspace/projects/
├── KY001_VERSION.md          # 版本详细记录
├── README_VERSION.md         # 版本管理指南
├── QUICK_REF.md              # 快速参考（本文件）
├── backup-ky001.sh           # 备份/恢复脚本
└── backup/
    └── KY001/                # KY001 备份目录
        ├── page.tsx          # 前端
        ├── route.ts          # 后端
        ├── package.json      # 依赖
        └── .coze             # 配置
```

## 🚀 快速测试

### 步骤 1：输入测试文本
```
我是真千金但你们才是假豪门-第1集
我是真千金但你们才是假豪门-第2集
这是正文内容第一段
这是正文内容第二段
```

### 步骤 2：填写报幕前缀
```
我是真千金但你们才是假豪门-第1集
```

### 步骤 3：点击"开始处理"

### 期望结果
```
这是正文内容第一段
这是正文内容第二段
```

## 🔍 调试日志

打开浏览器控制台（F12），查看：
- 接收到的参数
- 标准化后前缀
- 是否包含集数
- 提取的剧名
- 匹配结果

## ⚠️ 重要提示

1. **修改前备份**：修改关键文件前先执行 `./backup-ky001.sh backup`
2. **测试后恢复**：修改后先测试，确认无误后再更新 KY001
3. **定期检查**：定期验证 KY001 备份文件完整性
4. **查看日志**：出问题时查看 `tail -n 50 /app/work/logs/bypass/app.log`

## 📞 常见问题

### Q: 恢复后服务无法启动？
A: 运行 `pnpm install && coze dev`

### Q: 备份脚本无法执行？
A: 运行 `chmod +x backup-ky001.sh`

### Q: 如何确认当前是 KY001 版本？
A: 运行 `cat backup/KY001/backup_time.txt` 查看备份时间

### Q: 如何手动备份单个文件？
A: `cp src/app/page.tsx backup/KY001/page.tsx`

## 🎉 总结

KY001 是一个功能完整、稳定可靠的版本！

**推荐工作流程**：
1. 开发新功能
2. 充分测试
3. 确认无误后更新 KY001 备份
4. 记录版本变更

**需要帮助？**
查看完整文档：`cat README_VERSION.md`
查看版本详情：`cat KY001_VERSION.md`
