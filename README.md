# ConnectomeFlight

在线展示：[zhaofanbo.com/SenseFlight-Web](https://zhaofanbo.com/SenseFlight-Web/)

纯视觉与多模态飞行展示，支持顶部任务切换、双镜头同步回放、模型图拖动与键盘旋转、细胞筛选与画面放大。桌面、平板与手机采用适配布局。

仓库仅包含网页、画面、显示颜色贴图及经过取舍的回放信息；不提供 checkpoint、模型权重、偏置、完整中间层数值或训练代码。

本地预览：`python3 serve.py`

视觉与身体模型来自上游 FlyVis、FlyBody；界面参考 fly-brain 与 Neural Canvas。参见 [来源说明](ATTRIBUTION.md)。

当前纯视觉展示使用疏朗球形目标树林 v3 与 ConnectomeFlight-V（T4/T5、115 参数、update800），197 帧。144 维视觉特征经固定压缩后，展示标量读出、50 ms EMA 记忆和动作头。跟随与俯视双镜头、眼图、轨迹及活动颜色同步；俯视画面用细线小圆环标出果蝇。多模态 demo 使用 ConnectomeFlight-VO（Vis115 + 嗅觉残差，2454 参数、update28800），404 帧；活动图同步显示视觉基准、嗅觉记忆、残差及相加输出。
