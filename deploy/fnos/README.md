# fnOS 开发前置机

飞牛仅作为入口：统一网关 → 本包 Unix Socket → `http://192.168.199.152:3000`。
应用不接收飞牛用户身份，不校验代理密钥，所有访问者共用开发账号。代理使用 Go 标准库，支持 WebSocket、流式响应和视频 Range；NAS 登录 Cookie 不转发到开发电脑。

```bash
./scripts/build-fnos.sh  # 本机需要 Go，通过 SSH 使用 NAS 自带 fnpack
./dev.sh                # 正常启动同一套开发服务，前端 3000、后端 3001
```

在飞牛应用中心手动安装 `.tmp/fnos/infinite-canvas.fpk`，然后打开「无线画布」。安装需要管理员权限，也可使用 `sudo appcenter-cli install-fpk /tmp/infinite-canvas.fpk -v 1`。包名与 `/app/infinite-canvas` 必须一致，构建脚本会先检查这一规则。

本机与飞牛共用原有 `data/` 数据。直接访问 `http://localhost:3000` 会跳转到 `/app/infinite-canvas/`；无需专用启动参数、独立实例或独立数据目录。

NAS 地址默认为 `panpan@192.168.199.218`，构建时可用 `FNOS_SSH_TARGET` 覆盖；开发电脑 IP 改变时修改 `proxy.go` 的目标地址并重新打包。
