//! Bounded control channels between API handlers and owned workers.

use tokio::sync::mpsc;

use super::acquisition_worker::AcquisitionFrame;
use crate::server::types::{SdrCommand, SdrProcessorSettings};

/// Commands that can be applied without taking the processor lock in the
/// websocket orchestration loop. The acquisition worker consumes these values
/// at the next frame boundary.
#[derive(Debug)]
pub enum FastPathCommand {
  ApplySettings(SdrProcessorSettings),
  SetFrequency(u32),
}

/// Split lock-free settings commands from commands that require a dedicated
/// handler. The `Err` branch preserves ownership of all other commands.
pub fn into_fast_path(
  command: SdrCommand,
) -> Result<FastPathCommand, SdrCommand> {
  match command {
    SdrCommand::ApplySettings(settings) => {
      Ok(FastPathCommand::ApplySettings(settings))
    }
    SdrCommand::SetFrequency(frequency) => {
      Ok(FastPathCommand::SetFrequency(frequency))
    }
    SdrCommand::SetGain(gain) => {
      Ok(FastPathCommand::ApplySettings(SdrProcessorSettings {
        gain: Some(gain),
        ..Default::default()
      }))
    }
    SdrCommand::SetPpm(ppm) => {
      Ok(FastPathCommand::ApplySettings(SdrProcessorSettings {
        ppm: Some(ppm),
        ..Default::default()
      }))
    }
    SdrCommand::SetTunerAGC(enabled) => {
      Ok(FastPathCommand::ApplySettings(SdrProcessorSettings {
        tuner_agc: Some(enabled),
        ..Default::default()
      }))
    }
    SdrCommand::SetRtlAGC(enabled) => {
      Ok(FastPathCommand::ApplySettings(SdrProcessorSettings {
        rtl_agc: Some(enabled),
        ..Default::default()
      }))
    }
    other => Err(other),
  }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DeviceCommand {
  Initialize,
  SelectSource {
    source_id: String,
    source_epoch: u64,
  },
  SetFrequency {
    center_frequency_hz: u32,
  },
  SetPaused {
    paused: bool,
  },
  Shutdown,
}

#[derive(Debug, Clone)]
pub enum AcquisitionCommand {
  Read { source_epoch: u64 },
  Reconfigure { source_epoch: u64 },
  ForwardToCapture(AcquisitionFrame),
  Shutdown,
}

#[derive(Debug, Clone)]
pub enum DspCommand {
  Process(AcquisitionFrame),
  Shutdown,
}

#[derive(Debug, Clone)]
pub enum CaptureCommand {
  Write(AcquisitionFrame),
  Finish { source_epoch: u64 },
  Shutdown,
}

#[derive(Clone)]
pub struct WorkerCommands {
  pub device: mpsc::Sender<DeviceCommand>,
  pub acquisition: mpsc::Sender<AcquisitionCommand>,
  pub dsp: mpsc::Sender<DspCommand>,
  pub capture: mpsc::Sender<CaptureCommand>,
}

pub struct WorkerCommandReceivers {
  pub device: mpsc::Receiver<DeviceCommand>,
  pub acquisition: mpsc::Receiver<AcquisitionCommand>,
  pub dsp: mpsc::Receiver<DspCommand>,
  pub capture: mpsc::Receiver<CaptureCommand>,
}

/// Create bounded channels so a slow consumer cannot create an unbounded
/// backlog in the control plane. Display freshness is handled separately by
/// [`crate::streaming::LatestFramePublisher`].
pub fn bounded_worker_channels(
  capacity: usize,
) -> (WorkerCommands, WorkerCommandReceivers) {
  assert!(capacity > 0, "worker channel capacity must be positive");
  let (device, device_rx) = mpsc::channel(capacity);
  let (acquisition, acquisition_rx) = mpsc::channel(capacity);
  let (dsp, dsp_rx) = mpsc::channel(capacity);
  let (capture, capture_rx) = mpsc::channel(capacity);

  (
    WorkerCommands {
      device,
      acquisition,
      dsp,
      capture,
    },
    WorkerCommandReceivers {
      device: device_rx,
      acquisition: acquisition_rx,
      dsp: dsp_rx,
      capture: capture_rx,
    },
  )
}

#[cfg(test)]
mod tests {
  use super::{
    bounded_worker_channels, into_fast_path, DeviceCommand, FastPathCommand,
  };
  use crate::server::types::SdrCommand;

  #[tokio::test]
  async fn worker_commands_apply_bounded_backpressure() {
    let (commands, mut receivers) = bounded_worker_channels(1);

    commands
      .device
      .try_send(DeviceCommand::Initialize)
      .expect("first command fits in the bounded queue");
    assert!(commands.device.try_send(DeviceCommand::Shutdown).is_err());

    assert_eq!(
      receivers.device.recv().await,
      Some(DeviceCommand::Initialize)
    );
  }

  #[test]
  fn fast_path_commands_are_routed_without_losing_other_commands() {
    assert!(matches!(
      into_fast_path(SdrCommand::SetFrequency(1_234)),
      Ok(FastPathCommand::SetFrequency(1_234))
    ));

    let routed = into_fast_path(SdrCommand::SetGain(-3.5))
      .expect("gain should use the fast path");
    assert!(matches!(
      routed,
      FastPathCommand::ApplySettings(settings) if settings.gain == Some(-3.5)
    ));

    assert!(matches!(
      into_fast_path(SdrCommand::RestartDevice),
      Err(SdrCommand::RestartDevice)
    ));
  }
}
