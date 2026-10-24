# SenseFlight

在线展示：[zhaofanbo.com/SenseFlight-Web](https://zhaofanbo.com/SenseFlight-Web/)

纯视觉与多模态飞行展示，支持双镜头同步回放、模型图旋转、细胞筛选与画面放大。

仓库仅包含网页、画面、显示颜色贴图及经过取舍的回放信息；不提供 checkpoint、模型权重、偏置、完整中间层数值或训练代码。

本地预览：`python3 serve.py`

视觉与身体模型来自上游 FlyVis、FlyBody；界面参考 fly-brain 与 Neural Canvas。参见 [来源说明](ATTRIBUTION.md)。

当前纯视觉展示使用疏朗球形目标树林 v3 与 ConnectomeFlight-V（T4/T5、115 参数、update800），197 帧。144 维视觉特征经固定压缩后，展示标量读出、50 ms EMA 记忆和动作头。跟随与俯视双镜头、眼图、轨迹及活动颜色同步；俯视画面用细线小圆环标出果蝇。多模态 demo 保留原 408 帧回放。
