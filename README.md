# 物尽其用

校园共享设备预约与使用登记平台。页面使用原生 HTML、CSS 和 JavaScript；账号、设备档案、预约、报修、候补、维护、公告与站内消息使用 Supabase Auth 和 Postgres 保存。所有业务表启用 Row Level Security（RLS），浏览器仅使用项目的 publishable/anon key，不包含 service_role 密钥。

## 页面功能

- **邮箱账号**：邮箱注册、邮箱验证、登录、重发验证邮件、申请密码重置和设置新密码；注册时要求重复密码一致。
- **设备目录**：导入课程服务端设备 JSON；管理员补充类别、位置、型号、开放时间、最长借用时长、状态和说明。
- **预约**：选择设备、日期和时间段并填写用途；数据库阻止重叠预约及维护时段内的预约。预约者可以取消待确认或已确认的预约，管理员可确认或完成预约。
- **跨账号沟通**：在当日登记或近期开放协调列表中联系预约者。新会话绑定具体预约；数据库只允许会话成员读取和发送消息，页面每 4 秒刷新当前会话。
- **报修与候补**：用户提交设备问题、登记设备与候补日期，并查看自己的记录；管理员跟进问题状态。
- **维护、公告与统计**：管理员可登记维护窗口、发布设备公告、调整设备状态；统计读取设备累计次数和预约记录。

## 项目结构

- `index.html`：登录、设备目录、日历、预约、服务台、管理员工作区。
- `styles.css`：响应式布局和页面样式。
- `app.js`：前端交互、设备和日历展示。
- `auth-service.js`：Supabase Auth、会话管理、邮件验证回调、重置密码及消息接口。
- `cloud-service.js`：设备、日历、统计和预约数据适配器。
- `cloud-workflow.js`：预约、报修、候补、维护、公告和管理员档案操作。
- `config.js`：云端项目 URL 和 publishable/anon key 等公开配置。
- `supabase/migrations/202610220001_initial_schema.sql`：表、索引、冲突约束、权限策略和数据库函数。

## 部署步骤

### 1. 创建独立 Supabase 项目

预约业务需要独立 Supabase 项目。不要与其他用途的项目共用数据库。创建项目后，在 Supabase SQL Editor 执行 `supabase/migrations/202610220001_initial_schema.sql` 全文。

在 Project Settings → API 中复制 Project URL 与 publishable/anon key，填写到 `config.js`：

```js
window.SITE_CONFIG = Object.freeze({
  supabaseUrl: "https://你的项目ID.supabase.co",
  supabaseAnonKey: "你的 publishable 或 anon key",
  requestTimeoutMs: 8000,
  pageSize: 5,
  calendarMinYear: 2000,
  calendarMaxYear: 2100
});
```

publishable/anon key 本来就会出现在浏览器请求中；表权限由 RLS 控制。**切勿把 `service_role` key 放入 `config.js`、网页源码或 GitHub。**

### 2. 配置验证邮件与密码重置邮件

在 Supabase Authentication → URL Configuration 中设置生产网站的 Site URL，并把本地和生产站点地址加入 Redirect URLs，例如：

```text
http://localhost:5500/**
https://你的正式域名/**
```

启用邮箱确认。正式环境应在 Authentication → SMTP Settings 配置自有邮件服务商的 SMTP。Supabase 默认邮件服务有发送频率和投递能力限制，不适合正式用户规模。邮件模板应保留 Supabase 的验证链接变量；密码重置链接需要返回网站当前 URL。

### 3. 设置管理员账号

所有新注册用户默认都是普通用户。确认管理员邮箱已注册并完成验证后，在 SQL Editor 运行以下命令，将邮箱替换成你的管理员邮箱：

```sql
update public.profiles p
set role = 'admin'
from auth.users u
where p.id = u.id
  and lower(u.email) = lower('admin@example.com');
```

浏览器用户无法通过注册表单把自己提升为管理员。管理员角色由数据库资料表控制，不读取用户可自行修改的 user metadata。

### 4. 初始化设备目录

课程给出的 WCF 服务运行在本机，不适合作为已部署网站的公共后端。先打开：

```text
http://127.0.0.1:12345/getDevices?page=1&pageSize=10000
```

将返回的设备 JSON 保存为 `.json` 文件。登录正式网站的管理员账号，在“后台统计”点击“导入设备 JSON”，选中该文件。导入会保留 `No`、`Name`、`UseCount`，不猜测服务端没有返回的字段。之后管理员在设备列表中选择状态，并在“设备档案”里填写位置、型号、开放时间和说明。状态仍为“待设置”的设备不能预约；选择“开放预约”后才接受新预约。

### 5. 部署前端

推荐把 GitHub 仓库连接到 Vercel，Framework Preset 选择 Other，Build Command 留空，Output Directory 使用 `.`。也可以部署到其他能提供 HTTPS 静态文件的网站。修改 `config.js` 并提交后，重新部署。首次注册、验证邮件、登录、预约、报修、管理员操作和跨账号消息都应使用两台浏览器或两个独立账号实测。

本地开发时，在项目目录运行：

```bash
python3 -m http.server 5500
```

然后访问 `http://localhost:5500`。Windows 可运行：

```powershell
py -m http.server 5500
```

Supabase 项目 URL 和 key 必须已填写，且数据库 migration 已执行，否则登录/注册和云端功能不会启用。

## 演示账号与测试流程

仓库不保存通用演示账号或固定密码。为避免任何人都能用公开密码登录，演示账号应通过注册表单创建，并使用你能收信的独立邮箱完成验证。建议准备至少三个邮箱：普通用户 A、普通用户 B、管理员；管理员按上一节提升角色。

推荐验收顺序：

1. 使用用户 A 和用户 B 注册，分别完成验证；在不同浏览器配置文件或设备登录。
2. 管理员导入设备 JSON，完善设备资料并将至少一件设备设为“开放预约”。
3. 用户 A 对设备提交一个未来时段；管理员确认预约。
4. 用户 B 选择相同设备和重叠时间，数据库应拒绝请求；选择不重叠时段后预约成功。
5. 用户 B 从当日预约表或开放协调列表联系用户 A；双方发送消息并确认对话刷新，另一个未参与账号无法读取该会话。
6. 用户提交报修；管理员接手并解决；用户登记候补；管理员发布维护安排与项目公告。
7. 管理员将设备状态改为维护中或暂停使用，检查新预约会被拦截；恢复为开放预约后再次测试。
8. 分别测试未验证邮箱登录、重发验证邮件、忘记密码、重置链接过期、重复密码不一致、已登录退出和刷新后会话恢复。

不要把正式用户邮箱、密码或 SMTP 密钥写入报告截图、前端仓库或 README。可为课程演示创建临时邮箱账号，演示完成后按需删除用户。

## 数据与安全说明

- 新账号自动建立 `profiles` 资料，默认 `role='user'`；只有管理员能改设备状态、维护、公告和全局报修状态。
- 用户只能读自己的预约和报修。管理角色可读全部预约与报修。
- 公开预约时段接口不返回邮箱或用途；仅返回日期、时间、预约者称呼和是否本人，用于发现可联系的时段。
- 开启私聊时，数据库函数校验预约仍有效且预约者允许协调，然后建立双方会话成员记录。消息读取与写入均由会话成员 RLS 策略保护。
- 预约使用范围排斥约束避免同设备时段重叠；数据库触发器阻止设备未开放或维护期间新增预约。只有管理员可确认和完成预约；完成后累计使用次数加一。
- 候补登记当前会保存为云端记录；项目尚未配置自动邮件提醒，用户可在服务台查看自己的候补。
- 前端的邮箱验证与密码重置邮件投递取决于 Supabase Auth URL 与 SMTP 配置。部署后需按实际域名完成端到端验证。

## 排查问题

| 现象 | 检查项 |
| --- | --- |
| 登录入口提示尚未配置 | `config.js` 中的 `supabaseUrl` 与 `supabaseAnonKey` 是否正确。 |
| 401 或无法读取资料 | 邮箱是否已验证；是否执行了 migration；浏览器是否保存了有效会话。 |
| 设备目录为空 | 是否登录管理员并导入设备 JSON；导入账号是否已设为管理员。 |
| 邮件没有到达 | 检查 Authentication URL Configuration、Redirect URLs、邮件模板、垃圾邮件和 SMTP 日志。 |
| 页面有数据但预约按钮不可用 | 设备状态需由管理员改为“开放预约”；未知状态不会被默认视作可借。 |
| 预约冲突 | 数据库按同一设备的时间区间拒绝重叠预约；跨午夜预约也按时间戳比较。 |
| 联系预约者失败 | 该预约必须来自云端、仍有效且预约者开启协调；旧 WCF 登记没有云端账号映射，不能直接建立私聊。 |

## 本地检查

```bash
node --check app.js
node --check auth-service.js
node --check cloud-service.js
node --check cloud-workflow.js
node tests/cloud-config.test.js
```
