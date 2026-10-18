# Saga 模式：长事务

Saga 不是「一个长事务」，而是「一串短事务 + 一条补偿链」。

它解决的问题是：一个流程要跨很多服务、跑很久，不可能把整条链路锁在一个全局事务里。那就不锁了。每个状态各自提交，失败时按相反顺序调用补偿。中间态对别人可见，最终靠补偿收敛。

这个模型适合订单履约、出行、审批这类长流程；不适合「中间态绝对不能被人看见」的场景。

---

## 一、状态机：Saga 的骨架

Saga 用一张状态机定义描述流程。一个最简单的下单 Saga：

```json
{
  "Name": "orderSaga",
  "StartState": "CreateOrder",
  "States": {
    "CreateOrder": {
      "Type": "ServiceTask",
      "ServiceName": "orderService",
      "ServiceMethod": "create",
      "CompensateState": "CancelOrder",
      "Next": "DeductStock"
    },
    "DeductStock": {
      "Type": "ServiceTask",
      "ServiceName": "stockService",
      "ServiceMethod": "deduct",
      "CompensateState": "RestoreStock",
      "Next": "Succeed"
    },
    "CancelOrder": {
      "Type": "ServiceTask",
      "ServiceName": "orderService",
      "ServiceMethod": "cancel"
    },
    "RestoreStock": {
      "Type": "ServiceTask",
      "ServiceName": "stockService",
      "ServiceMethod": "restore"
    },
    "Succeed": { "Type": "Succeed" }
  }
}
```

`StateMachineParserImpl.parse()` 解析 `Name`、`Version`、`StartState`、`States`，按 `Type` 选 `StateParser`，把每个 state 放进 map，最后把 `CompensateState` 指向的 state 标记为 `ForCompensation`。

每个 `ServiceTask` 都是一次本地服务调用。`ServiceTaskStateHandler` 调 `ServiceInvoker`，异常写入 `VAR_NAME_CURRENT_EXCEPTION`，再交给 `EngineUtils.handleException()` 匹配 `Catch`。

---

## 二、执行：每个 state 各自提交

`ProcessCtrlStateMachineEngine.startInternal()` 创建状态机实例，记录 `StateMachineStarted` 事件，然后从 `StartState` 开始推进。每个 `ServiceTask` 调用业务方法，成功后按 `Next` 走到下一个 state。

关键点：**每个 state 都是一个独立的本地事务，提交后立刻可见。** Saga 没有全局锁，也没有 XA 的 prepare 阶段。

这意味着：订单已经创建、库存还没扣的那几百毫秒里，别的请求能看到这张订单。如果你的业务不能接受这种中间态，要么在查询侧过滤，要么用 AT/TCC 把关键步骤的可见性收紧。

补偿也不是数据库回滚。`CancelOrder` 可能是「把订单状态改成已取消」，而不是「删除订单」；`RestoreStock` 可能是「加回库存」，而不是「把库存字段改回原值」。补偿是业务语义上的撤销，不是物理上的倒带。

---

## 三、失败不会自动补偿

这是 Saga 最容易被误解的地方。

状态抛异常后，引擎只做一件事：看这个状态有没有配 `Catch`。

- 配了 `Catch`，并且 `Catch.Next` 指向一个 `CompensationTrigger` 状态，引擎才会开始补偿；
- 没配 `Catch`，异常往上抛，状态机进入失败，但不会自动补偿。

`EngineUtils.handleException()` 只匹配 `Catch`；匹配成功就把路由写入 `VAR_NAME_CURRENT_EXCEPTION_ROUTE`，不匹配就标记「异常未捕获」。`CompensationTriggerStateHandler` 收到触发后，收集已成功且配置了补偿 state 的实例，把机器状态置为 `UN`，compensationStatus 置为 `RU`。

`TaskStateRouter.compensateRoute()` 从已执行状态栈里逆序弹出，路由到对应的 `CompensateState`。`CompensationHolder` 对 `isForUpdate` 但没配 `CompensateState` 的状态直接报错。

所以补偿是一条显式路由，不是框架的默认行为。你可以把它理解成「异常处理里手动调了一个补偿入口」，而不是「事务框架自动回滚」。

---

## 四、TC 的 commit 可能是「继续执行」

Saga 也用 TC，但用法很特别。

`SagaCore.doGlobalCommit()` 不会遍历真实分支，而是临时造一个 `branchId = -1` 的虚拟分支，发 `BranchCommitRequest`。RM 侧 `SagaResourceManager.branchCommit()` 收到后，调的是：

```java
StateMachineEngineHolder.getStateMachineEngine().forward(xid, null);
```

不是「提交本地事务」，是「把状态机继续往前推」。如果状态机还没跑完，TC 的 commit 会继续执行剩下的状态；如果已经成功结束，forward 直接返回 `PhaseTwo_Committed`。

回滚也一样：`SagaCore.doGlobalRollback()` 造一个 `branchId = -1` 的分支，`SagaResourceManager.branchRollback()` 调 `engine.compensate(xid, null)`，让引擎逆序补偿。

默认情况下，Saga 不会给每个状态注册分支（`client.saga.branchRegisterEnable=false`）。TC 眼里只有一个虚拟分支，真正的状态推进和补偿都在 Saga 引擎本地完成。

这解释了一个现象：Saga 的 TC 会话看起来「分支很少」，但状态机可能已经跑了几十个 state。用分支数判断 Saga 进度会误判。

---

## 五、重试：两套配置，不要混

Saga 有两层重试。

**状态机内重试**：`ServiceTask` 可以配 `Retry`，支持 `Exceptions`、`IntervalSeconds`、`MaxAttempts`、`BackoffRate`。`SpringBeanServiceInvoker` 在调用业务方法时按这个配置循环执行。

注意，运行时没有补默认值：`interval/backoff` 默认 0，`MaxAttempts` 必填，缺省会拆箱 NPE。不写就是 0 秒立即重试，而且必须显式给次数。

**TC 重试**：全局 commit/rollback 失败时，TC 按自己的 1 秒周期重试；TM 的 commit/rollback 也有 5 次 RPC 重试。这两层和状态机内重试是独立的，配置不要混。

还有一个特殊策略：`RecoverStrategy=Forward`。全局事务超时回滚时，`SagaResourceManager.branchRollback()` 看到这个策略，会返回 `PhaseTwo_CommitFailed_Retryable`，让 TC 继续尝试 forward，而不是补偿。这是给「宁可继续往前跑，也不往回退」的长流程准备的，不是默认行为。

---

## 六、Saga 的代价

**中间态可见。** 每个本地事务提交后立刻可见，没有全局锁。

**补偿是业务语义。** 补偿方法可能失败、可能不幂等、可能只完成一半。Saga 不会替你检查「这个补偿是不是已经执行过」。

**补偿失败只能重试或人工。** 补偿 state 自己也是 `ServiceTask`，有自己的重试配置；失败后状态机进入补偿失败，TC 拿到 `PhaseTwo_RollbackFailed_Retryable`，按回滚重试策略继续发。

**流程定义是代码之外的资产。** 状态机 JSON 需要版本管理、校验、存储；改流程和改代码一样需要评审。

---

## 七、踩坑清单

- 以为失败会自动补偿：没有配 `Catch.Next=CompensationTrigger`，异常只会让状态机失败。
- 补偿方法不幂等：TC 回滚重试会重复执行补偿，制造新的数据。
- 用分支数判断 Saga 进度：默认只有一个虚拟分支。
- 把 `RecoverStrategy=Forward` 当默认行为：它只在超时回滚时生效，而且会让 TC 继续 forward。
- 状态机 `Retry.MaxAttempts` 不写：缺省拆箱 NPE；写了 0 次就是不重试。
- 以为 TC 的 commit 一定结束流程：Saga 的 commit 可能只是继续 forward。
- 中间态被下游当成终态：Saga 的每个 state 提交后都可见，查询侧要自己处理。

---

## 附：这一章的源码入口

一次状态机启动：

```text
StateMachineRepositoryImpl.getStateMachine()
  → StateMachineParserImpl.parse()                     // :62
    → ProcessCtrlStateMachineEngine.startInternal()    // :109
      → 记录 StateMachineStarted
      → 从 StartState 推进
```

一次 TC commit：

```text
SagaCore.doGlobalCommit()                              :105
  → SessionHelper.newBranch(..., branchId = -1)        :109
    → SagaResourceManager.branchCommit()               :86
      → engine.forward(xid, null)                      :91
```

一次 TC rollback：

```text
SagaCore.doGlobalRollback()                            :170
  → SagaResourceManager.branchRollback()               :131
    → engine.compensate(xid, null)                     :149
      → CompensationTriggerStateHandler                :40
      → TaskStateRouter.compensateRoute()              :115
```

| 本文结论 | 源码证据 | 照搬之前先确认 |
| --- | --- | --- |
| 每个 state 是独立本地事务 | `ServiceTaskStateHandler.java:56`、`ProcessCtrlStateMachineEngine.java:109` | 你的查询侧能否接受中间态可见 |
| 失败不自动补偿 | `EngineUtils.handleException():195`、`CompensationTriggerStateHandler.java:43` | 你的状态机是否配了 `Catch.Next` |
| TC 的 commit 可能是 forward | `SagaCore.doGlobalCommit():105`、`SagaResourceManager.branchCommit():86` | 你的状态机是否允许「提交时继续执行」 |
| 默认不逐 state 注册分支 | `DefaultValues.java:78`、`DbAndReportTcStateLogStore.branchRegister():338` | 你是否用分支数判断进度 |
| 补偿失败会继续重试 | `SagaResourceManager.branchRollback():131` | 补偿方法是否幂等 |

入口清单：

- `saga/seata-saga-statelang/src/main/java/org/apache/seata/saga/statelang/parser/impl/StateMachineParserImpl.java`：`parse()`（`:62`）
- `saga/seata-saga-engine/src/main/java/org/apache/seata/saga/engine/impl/ProcessCtrlStateMachineEngine.java`：`startInternal()`（`:109`）、`forward()`（`:223`）、`compensate()`（`:495`）
- `saga/seata-saga-engine/src/main/java/org/apache/seata/saga/engine/pcext/handlers/ServiceTaskStateHandler.java`：执行（`:56`）
- `saga/seata-saga-engine/src/main/java/org/apache/seata/saga/engine/pcext/utils/EngineUtils.java`：`handleException()`（`:195`）
- `saga/seata-saga-engine/src/main/java/org/apache/seata/saga/engine/pcext/handlers/CompensationTriggerStateHandler.java`：补偿触发（`:43`）
- `saga/seata-saga-engine/src/main/java/org/apache/seata/saga/engine/pcext/routers/TaskStateRouter.java`：`compensateRoute()`（`:115`）
- `server/src/main/java/org/apache/seata/server/transaction/saga/SagaCore.java`：`doGlobalCommit()`（`:105`）、`doGlobalRollback()`（`:170`）
- `saga/seata-saga-rm/src/main/java/org/apache/seata/saga/rm/SagaResourceManager.java`：`branchCommit()`（`:86`）、`branchRollback()`（`:131`）
- `saga/seata-saga-spring/src/main/java/org/apache/seata/saga/engine/store/db/DbAndReportTcStateLogStore.java`：`branchRegister()`（`:338`）
- `common/src/main/java/org/apache/seata/common/DefaultValues.java`：`DEFAULT_CLIENT_SAGA_BRANCH_REGISTER_ENABLE`（`:78`）

---

## 思考题

1. Saga 的状态机没有配 `Catch.Next=CompensationTrigger`，某个状态抛异常后会发生什么？TC 看到的全局事务状态是什么？
2. 为什么 TC 的 commit 对 Saga 可能是「继续 forward」？这个设计解决了什么问题，又带来什么风险？
3. Saga 的补偿方法为什么要幂等？TC 在什么情况下会重复调用补偿？
4. 一个长流程里，中间态被下游服务当成终态处理了。这是 Saga 的 bug 还是使用问题？应该在哪一层解决？
