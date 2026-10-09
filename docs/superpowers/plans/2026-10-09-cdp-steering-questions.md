# CDP 运行中提问与引导

目标：恢复结构化desktop-control的turn/steer；按isBlocking展示用户问题，非阻塞问题不遮挡聊天、不主动暂停任务；补读当前已订阅会话的主机管理器待回答请求。

约束：仅当前已订阅的明确threadId，保留host隔离。对当前构建的既有AppHost服务读取，不重复注册AppView。未验证的桌面构建/缺少管理器则保留原窗口事件通道，不伪造问题。未知写入不自动重发、不恢复成可误重发草稿。只以serverRequest/resolved/权威管理器快照清理问题。不自动选择选项或提交答案。

分工：
- 前端：App、ConversationPage、ApprovalSheet、新非阻塞问题卡及UI测试；恢复引导入口、附件转路径、失败/未知区分。
- 通道：ControlTransport增加可选readUserQuestions(targets)和respondUserQuestion(hostId,request,answers)。channel.refreshUserQuestions负责合并去重、撤销和回应路由；gateway按客户端订阅目标定时刷新；turn/steer加入写方法。
- 宿主：CdpControlTransport复用已初始化AppHost manager；readUserQuestions返回[{hostId,threadId,requests:[原生JSON-RPC question request]}]，只有读取到完整requests数组的会话才返回权威快照。只接item/tool/requestUserInput。回答前复核仍存在，并调用replyWithUserInputResponse(threadId,id,result)。不操作真实受保护桌面，只跑受控测试；用户端产生的安全诊断可回读。

验证：问题isBlocking=false时输出继续追加且输入可用，允许选择/自由文字并提交；在桌面已回答的请求失效；host隔离与去重；引导expectedTurnId正确，普通拒绝恢复草稿，未知不重发；浏览器同时验证非阻塞卡、引导和原有审批。真实桌面验收单独报告。
