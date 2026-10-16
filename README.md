# SenseFlight

在线展示：[zhaofanbo.com/SenseFlight-Web](https://zhaofanbo.com/SenseFlight-Web/)

纯视觉与多模态飞行展示，支持双镜头同步回放、模型图旋转、细胞筛选与画面放大。

仓库仅包含网页、画面、显示颜色贴图及经过取舍的回放信息；不提供 checkpoint、模型权重、偏置、完整中间层数值或训练代码。

本地预览：`python3 serve.py`

视觉与身体模型来自上游 FlyVis、FlyBody；界面参考 fly-brain 与 Neural Canvas。参见 [来源说明](ATTRIBUTION.md)。

当前纯视觉展示为随机树林中的可见棋盘目标导航，采用 ConnectomeFlight-V（T4/T5 读出、3131 参数），网络隐藏层均为 17 维。视觉跟随镜头采用侧后方视角；两项任务的俯视画面均使用细线小圆环标出果蝇。
