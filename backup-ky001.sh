#!/bin/bash

# 版本备份/恢复脚本
# 支持快速备份和恢复不同版本

BACKUP_DIR="/workspace/projects/backup"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# 颜色输出
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 关键文件列表
KEY_FILES=(
    "src/app/page.tsx"
    "src/app/api/process/route.ts"
    "package.json"
    ".coze"
)

# 创建备份
backup() {
    VERSION=${1:-"KY001"}
    
    echo -e "${GREEN}📦 开始备份 $VERSION 版本...${NC}"
    
    mkdir -p "$BACKUP_DIR/$VERSION"
    
    for file in "${KEY_FILES[@]}"; do
        if [ -f "/workspace/projects/$file" ]; then
            cp "/workspace/projects/$file" "$BACKUP_DIR/$VERSION/"
            echo -e "${GREEN}✅ 已备份: $file${NC}"
        else
            echo -e "${RED}❌ 文件不存在: $file${NC}"
        fi
    done
    
    # 创建备份时间戳
    echo "$TIMESTAMP" > "$BACKUP_DIR/$VERSION/backup_time.txt"
    echo "$VERSION" > "$BACKUP_DIR/$VERSION/version.txt"
    
    echo -e "${GREEN}🎉 $VERSION 备份完成！备份位置: $BACKUP_DIR/$VERSION${NC}"
}

# 恢复备份
restore() {
    VERSION=${1:-"KY001"}
    
    echo -e "${YELLOW}⚠️  开始恢复 $VERSION 版本...${NC}"
    
    if [ ! -d "$BACKUP_DIR/$VERSION" ]; then
        echo -e "${RED}❌ 备份目录不存在: $BACKUP_DIR/$VERSION${NC}"
        exit 1
    fi
    
    for file in "${KEY_FILES[@]}"; do
        if [ -f "$BACKUP_DIR/$VERSION/$(basename $file)" ]; then
            cp "$BACKUP_DIR/$VERSION/$(basename $file)" "/workspace/projects/$file"
            echo -e "${GREEN}✅ 已恢复: $file${NC}"
        else
            echo -e "${RED}❌ 备份文件不存在: $(basename $file)${NC}"
        fi
    done
    
    echo -e "${GREEN}🎉 $VERSION 恢复完成！${NC}"
    echo -e "${YELLOW}💡 请运行以下命令重启服务:${NC}"
    echo -e "${YELLOW}   coze dev${NC}"
}

# 列出所有版本
list() {
    echo -e "${BLUE}📋 可用版本列表：${NC}"
    echo ""
    
    if [ ! -d "$BACKUP_DIR" ]; then
        echo -e "${RED}❌ 备份目录不存在${NC}"
        exit 1
    fi
    
    for dir in "$BACKUP_DIR"/KY*; do
        if [ -d "$dir" ]; then
            VERSION=$(basename "$dir")
            if [ -f "$dir/backup_time.txt" ]; then
                TIME=$(cat "$dir/backup_time.txt")
                echo -e "${GREEN}  - $VERSION${NC} (备份时间: $TIME)"
            else
                echo -e "${YELLOW}  - $VERSION${NC} (无时间戳)"
            fi
        fi
    done
    echo ""
}

# 显示帮助
show_help() {
    echo "版本备份/恢复脚本"
    echo ""
    echo "用法:"
    echo "  ./backup-ky001.sh backup [VERSION]   - 备份当前版本到指定版本（默认KY001）"
    echo "  ./backup-ky001.sh restore [VERSION]  - 从指定版本恢复（默认KY001）"
    echo "  ./backup-ky001.sh list               - 列出所有可用版本"
    echo "  ./backup-ky001.sh help               - 显示此帮助信息"
    echo ""
    echo "示例:"
    echo "  ./backup-ky001.sh backup KY001       # 备份为 KY001 版本"
    echo "  ./backup-ky001.sh backup KY002       # 备份为 KY002 版本"
    echo "  ./backup-ky001.sh restore KY001      # 恢复到 KY001 版本"
    echo "  ./backup-ky001.sh restore KY002      # 恢复到 KY002 版本"
    echo "  ./backup-ky001.sh list               # 查看所有版本"
    echo ""
    echo "备份位置: $BACKUP_DIR"
}

# 主函数
case "$1" in
    backup)
        backup "$2"
        ;;
    restore)
        restore "$2"
        ;;
    list)
        list
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        echo -e "${RED}❌ 未知参数: $1${NC}"
        show_help
        exit 1
        ;;
esac
