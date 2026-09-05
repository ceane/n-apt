//! Runtime boundaries for streaming control and data flow.
//!
//! The existing server loop still owns the legacy integration path. These
//! channel and event types provide the narrower interfaces that the workers
//! will use as that loop is migrated in small, behavior-preserving slices.

pub mod acquisition_worker;
pub mod analysis_worker;
pub mod commands;
pub mod dsp_worker;
pub mod publisher;
pub mod websocket;

pub use acquisition_worker::{AcquisitionFrame, FramePublicationGate};
pub use commands::{
  bounded_worker_channels, AcquisitionCommand, CaptureCommand, DeviceCommand,
  DspCommand, WorkerCommandReceivers, WorkerCommands,
};
pub use dsp_worker::SpectrumFrame;
pub use publisher::LatestFramePublisher;
pub use websocket::WebSocketEventBus;

/// Events emitted by the worker boundaries and consumed by application
/// orchestration or transport adapters.
pub mod events {
  use std::sync::Arc;

  use super::{AcquisitionFrame, SpectrumFrame};

  pub use crate::app::readiness::ReadinessEvent;

  #[derive(Debug, Clone, PartialEq, Eq)]
  pub enum DeviceEvent {
    Loading,
    Ready { device_type: String },
    Failed { message: String },
    Disconnected,
    Shutdown,
  }

  #[derive(Debug, Clone)]
  pub enum AcquisitionEvent {
    Frame(AcquisitionFrame),
    Dropped {
      source_epoch: u64,
      frame_sequence: u64,
    },
    Ended {
      source_epoch: u64,
    },
  }

  #[derive(Debug, Clone)]
  pub enum SpectrumEvent {
    Frame(Arc<SpectrumFrame>),
    Dropped {
      source_epoch: u64,
      frame_sequence: u64,
    },
  }

  #[derive(Debug, Clone)]
  pub enum CaptureEvent {
    BlockWritten {
      source_epoch: u64,
      first_sample: u64,
      sample_count: usize,
    },
    Completed {
      source_epoch: u64,
    },
    Failed {
      source_epoch: u64,
      message: String,
    },
  }

  #[derive(Debug, Clone, PartialEq, Eq)]
  pub enum SourceLifecycleEvent {
    SwitchRequested {
      source_id: String,
      source_epoch: u64,
    },
    Switched {
      source_id: String,
      source_epoch: u64,
    },
    SwitchFailed {
      source_id: String,
      message: String,
    },
  }
}
