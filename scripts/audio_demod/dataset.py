"""Read and validate the browser-exported, binary audio-demod corpus."""

from __future__ import annotations

import hashlib
import json
import pathlib
import tarfile

import numpy as np


DATASET_FORMAT = "napt-audio-demod-training-tar"
DATASET_VERSION = 1
SPLIT_FORMAT = "napt-audio-demod-session-splits"
SPLITS = ("train", "validation", "test")
MODEL_VERSION = 4
INPUT_SIZE = 192
HIDDEN_SIZE = 12
MAX_ARCHIVE_BYTES = 256_000_000
PREPROCESSING_CONTRACT = {
    "iqEncoding": "u8-interleaved",
    "iqNormalization": "(value-128)/128",
    "iqContext": "64-complex-samples-oldest-first-zero-padded-on-left",
    "fourier": "64-point-hann-symmetric-fftshift-log-power",
    "fourierNormalization": "(binDb-maxDb)/50-clamped-to[-1,0]-with-50dB-floor",
    "pcmEncoding": "float32-le",
    "samplePairing": "current-iq-index=floor(((pcmIndex+0.5)*iqCount)/pcmCount)",
}


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _file_sha256(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _read_json(data: bytes, description: str) -> dict:
    try:
        value = json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError(f"{description} is not valid UTF-8 JSON") from error
    if not isinstance(value, dict):
        raise ValueError(f"{description} must be a JSON object")
    return value


def _safe_members(archive: tarfile.TarFile) -> dict[str, tarfile.TarInfo]:
    members = {}
    for member in archive.getmembers():
        path = pathlib.PurePosixPath(member.name)
        if (
            not member.isfile()
            or path.is_absolute()
            or ".." in path.parts
            or not path.parts
            or member.name in members
        ):
            raise ValueError("Dataset archive contains an unsafe or duplicate entry")
        if member.size < 0 or member.size > MAX_ARCHIVE_BYTES:
            raise ValueError("Dataset archive entry exceeds the supported size")
        members[member.name] = member
    return members


def _read_member(archive: tarfile.TarFile, member: tarfile.TarInfo) -> bytes:
    stream = archive.extractfile(member)
    if stream is None:
        raise ValueError(f"Could not read dataset entry: {member.name}")
    data = stream.read(MAX_ARCHIVE_BYTES + 1)
    if len(data) != member.size:
        raise ValueError(f"Dataset entry size mismatch: {member.name}")
    return data


def _load_array(
    archive: tarfile.TarFile,
    members: dict[str, tarfile.TarInfo],
    descriptor: dict,
    *,
    dtype: str,
    expected_encoding: str,
) -> np.ndarray:
    path = descriptor.get("path")
    if not isinstance(path, str) or path not in members:
        raise ValueError("Dataset array path is missing from the archive")
    if descriptor.get("encoding") != expected_encoding:
        raise ValueError(f"Unsupported array encoding for {path}")
    data = _read_member(archive, members[path])
    if descriptor.get("byteLength") != len(data):
        raise ValueError(f"Dataset array byte length mismatch: {path}")
    if descriptor.get("sha256") != _sha256(data):
        raise ValueError(f"Dataset array checksum mismatch: {path}")
    values = np.frombuffer(data, dtype=np.dtype(dtype))
    if not np.isfinite(values).all():
        raise ValueError(f"Dataset array contains non-finite values: {path}")
    return values


def _load_archive(path: pathlib.Path) -> tuple[dict, list[tuple[dict, np.ndarray, np.ndarray, dict[str, np.ndarray]]]]:
    if path.stat().st_size > MAX_ARCHIVE_BYTES:
        raise ValueError(f"Dataset archive exceeds 256 MB: {path}")
    try:
        archive = tarfile.open(path, mode="r:")
    except (tarfile.TarError, OSError) as error:
        raise ValueError(f"Could not open audio-demod tar archive: {path}") from error
    with archive:
        members = _safe_members(archive)
        manifest_member = members.get("manifest.json")
        if manifest_member is None:
            raise ValueError("Dataset archive is missing manifest.json")
        manifest = _read_json(_read_member(archive, manifest_member), "Dataset manifest")
        if manifest.get("format") != DATASET_FORMAT or manifest.get("version") != DATASET_VERSION:
            raise ValueError("Unsupported audio-demod dataset format or version")
        contract = manifest.get("modelContract")
        if not isinstance(contract, dict) or contract != {
            "version": MODEL_VERSION,
            "inputName": "iq_fourier_windows",
            "outputName": "pcm",
            "inputShape": ["batch", INPUT_SIZE],
            "outputShape": ["batch", 1],
            "architecture": "64-complex-iq-plus-64-fourier-features-to-pcm",
        }:
            raise ValueError("Dataset model input/output contract does not match audio model v4")
        if manifest.get("preprocessing") != PREPROCESSING_CONTRACT:
            raise ValueError("Dataset preprocessing contract does not match the browser v4 features")
        examples = manifest.get("examples")
        if not isinstance(examples, list) or not examples:
            raise ValueError("Dataset archive contains no paired examples")
        if manifest.get("exampleCount") != len(examples):
            raise ValueError("Dataset example count does not match its manifest")
        declared_sessions = manifest.get("sessionIds")
        actual_sessions = sorted(
            {
                example.get("sessionId")
                for example in examples
                if isinstance(example, dict) and isinstance(example.get("sessionId"), str)
            }
        )
        if (
            not isinstance(declared_sessions, list)
            or any(not isinstance(value, str) for value in declared_sessions)
            or sorted(set(declared_sessions)) != actual_sessions
        ):
            raise ValueError("Dataset session inventory does not match its paired examples")

        loaded = []
        seen_ids = set()
        for example in examples:
            if not isinstance(example, dict):
                raise ValueError("Dataset example metadata must be an object")
            artifact_id = example.get("artifactId")
            session_id = example.get("sessionId")
            if not isinstance(artifact_id, str) or not artifact_id or artifact_id in seen_ids:
                raise ValueError("Dataset has a missing or duplicate artifact ID")
            if not isinstance(session_id, str) or not session_id:
                raise ValueError("Every paired example requires a session ID")
            alignment = example.get("alignment")
            if not isinstance(alignment, dict) or not isinstance(alignment.get("method"), str):
                raise ValueError(f"Paired example has no alignment record: {artifact_id}")
            seen_ids.add(artifact_id)

            iq = example.get("iq")
            reference = example.get("reference")
            if not isinstance(iq, dict) or not isinstance(reference, dict):
                raise ValueError("Every example requires I/Q and reference descriptors")
            iq_data = _load_array(
                archive,
                members,
                iq,
                dtype="u1",
                expected_encoding="u8-interleaved",
            )
            if iq_data.size < 128 or iq_data.size % 2:
                raise ValueError(f"I/Q capture is too short or incomplete: {artifact_id}")
            if iq.get("complexSampleCount") != iq_data.size // 2:
                raise ValueError(f"I/Q sample count mismatch: {artifact_id}")

            reference_pcm = _load_array(
                archive,
                members,
                reference,
                dtype="<f4",
                expected_encoding="float32-le",
            )
            if reference_pcm.size < 128 or reference.get("sampleCount") != reference_pcm.size:
                raise ValueError(f"Reference PCM sample count mismatch: {artifact_id}")

            baselines = {}
            for name, descriptor in (example.get("baselines") or {}).items():
                if name not in ("am", "fm", "apt") or not isinstance(descriptor, dict):
                    raise ValueError(f"Unknown DSP baseline on {artifact_id}")
                baseline = _load_array(
                    archive,
                    members,
                    descriptor,
                    dtype="<f4",
                    expected_encoding="float32-le",
                )
                if descriptor.get("sampleCount") != baseline.size:
                    raise ValueError(f"DSP baseline sample count mismatch: {artifact_id}")
                baselines[name] = baseline

            profile = (
                example.get("channelId"),
                example.get("centerFrequencyHz"),
                example.get("bandwidthHz"),
                iq.get("sampleRateHz"),
                reference.get("sampleRateHz"),
            )
            if (
                not isinstance(profile[0], str)
                or not profile[0]
                or not all(isinstance(value, (int, float)) and np.isfinite(value) and value > 0 for value in profile[1:])
            ):
                raise ValueError(f"Invalid channel or sample-rate metadata: {artifact_id}")
            loaded.append((example, iq_data, reference_pcm, baselines))
        return manifest, loaded


def load_training_corpus(dataset_paths: list[str], split_path: str) -> dict:
    if not dataset_paths:
        raise ValueError("At least one --dataset archive is required")
    split_file = pathlib.Path(split_path)
    try:
        split_manifest = _read_json(split_file.read_bytes(), "Session split file")
    except OSError as error:
        raise ValueError(f"Could not read session split file: {split_path}") from error
    if split_manifest.get("format") != SPLIT_FORMAT or split_manifest.get("version") != 1:
        raise ValueError("Unsupported session split format or version")
    session_splits = split_manifest.get("sessionSplits")
    if not isinstance(session_splits, dict) or not session_splits:
        raise ValueError("Explicit session-level split assignments are required")
    if any(not isinstance(session, str) or not session or split not in SPLITS for session, split in session_splits.items()):
        raise ValueError("Each session must be assigned train, validation, or test")

    manifests = []
    rows = []
    dataset_digests = []
    seen_ids = set()
    for raw_path in dataset_paths:
        path = pathlib.Path(raw_path)
        manifest, entries = _load_archive(path)
        dataset_digests.append(_file_sha256(path))
        manifests.append(manifest)
        for example, iq_data, reference_pcm, baselines in entries:
            if example["artifactId"] in seen_ids:
                raise ValueError("The same reference pair appears in more than one archive")
            seen_ids.add(example["artifactId"])
            session_id = example["sessionId"]
            if session_id not in session_splits:
                raise ValueError(f"Session has no explicit split assignment: {session_id}")
            rows.append(
                {
                    "metadata": example,
                    "sessionId": session_id,
                    "split": session_splits[session_id],
                    "iq": iq_data,
                    "reference": reference_pcm,
                    "baselines": baselines,
                }
            )
    dataset_sessions = {row["sessionId"] for row in rows}
    if set(session_splits) != dataset_sessions:
        unused = sorted(set(session_splits) - dataset_sessions)
        if unused:
            raise ValueError(f"Split file includes sessions absent from the dataset: {', '.join(unused)}")
    for split in SPLITS:
        if not any(row["split"] == split for row in rows):
            raise ValueError(f"At least one independent session must be assigned to {split}")

    profiles = {
        (
            row["metadata"]["iq"]["sampleRateHz"],
            row["metadata"]["bandwidthHz"],
            row["metadata"]["reference"]["sampleRateHz"],
        )
        for row in rows
    }
    if len(profiles) != 1:
        raise ValueError("A training run must use one I/Q rate, channel width, and PCM rate profile")
    iq_rate, bandwidth, pcm_rate = next(iter(profiles))
    digest = hashlib.sha256()
    for value in sorted(dataset_digests):
        digest.update(value.encode("ascii"))
    digest.update(_file_sha256(split_file).encode("ascii"))
    return {
        "rows": rows,
        "session_splits": dict(sorted(session_splits.items())),
        "dataset_sha256": digest.hexdigest(),
        "profile": {
            "iqSampleRateHz": iq_rate,
            "bandwidthHz": bandwidth,
            "pcmSampleRateHz": pcm_rate,
        },
        "manifests": manifests,
    }
