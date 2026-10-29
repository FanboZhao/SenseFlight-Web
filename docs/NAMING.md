# SenseFlight naming

Research: SenseFlight. Display project: SenseFlight-Web. Pure visual: SenseFlight-Vis (V). Multimodal: SenseFlight-VisOlf (VO).

Displayed model names: ConnectomeFlight-V (T4/T5 readout, 115 trainable parameters; fixed 104-dimensional compression and 50 ms EMA) and ConnectomeFlight-VO (Vis115 plus odor-conditioned residual, 2454 trainable parameters). Neither current demonstration uses the historical M capacity suffix. Upstream FlyVis and FlyBody keep their original names.

The public entry point is `dist/index.html`. `dist/app.js` controls presentation playback and display rendering. This repository has no Python research package or training entry point.

当前多模态演示名为 ConnectomeFlight-VO · Vis115 · 2454 参数。它使用完整 Vis115 视觉分支与嗅觉残差控制；旧 M 容量名只用于历史模型。
