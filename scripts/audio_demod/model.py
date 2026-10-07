"""Compact waveform regressor matching the browser's v4 ONNX surface."""

from __future__ import annotations


def create_model(torch):
    class AudioDemodModel(torch.nn.Module):
        def __init__(self):
            super().__init__()
            self.input = torch.nn.Linear(192, 12)
            self.output = torch.nn.Linear(12, 1)

        def forward(self, iq_fourier_windows):
            hidden = torch.tanh(self.input(iq_fourier_windows))
            return torch.tanh(self.output(hidden))

    return AudioDemodModel()
