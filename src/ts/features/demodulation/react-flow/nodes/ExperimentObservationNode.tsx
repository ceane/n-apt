import React, { useState } from "react";
import styled from "styled-components";
import { ClipboardPlus } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@n-apt/redux";
import { addExperimentLabel, createNoteCardFromSpectrum, selectExperimentLabels, selectNoteCards } from "@n-apt/redux";
import { captureExperimentFftSnapshot, normalizeExperimentLabels } from "@n-apt/demodulation/react-flow/nodes/experimentLabels";

const Card = styled.section`
  display: grid;
  gap: 9px;
  width: 320px;
  padding: 14px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 12px;
  background: ${({ theme }) => theme.colors.surface};
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 11px;
`;

const Header = styled.header`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 700;
`;

const Field = styled.input`
  width: 100%;
  min-height: 34px;
  padding: 7px 8px;
  box-sizing: border-box;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 7px;
  background: ${({ theme }) => theme.colors.background};
  color: ${({ theme }) => theme.colors.textPrimary};
  font: inherit;
`;

const Observation = styled.textarea`
  width: 100%;
  min-height: 86px;
  padding: 8px;
  box-sizing: border-box;
  resize: vertical;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 7px;
  background: ${({ theme }) => theme.colors.background};
  color: ${({ theme }) => theme.colors.textPrimary};
  font: inherit;
  line-height: 1.45;
`;

const LabelPills = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
`;

const Pill = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 100%;
  padding: 3px 7px;
  border: 1px solid ${({ theme }) => theme.colors.primary}66;
  border-radius: 999px;
  background: ${({ theme }) => theme.colors.primary}12;
  overflow-wrap: anywhere;
`;

const SmallButton = styled.button`
  min-height: 28px;
  padding: 4px 8px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 7px;
  background: ${({ theme }) => theme.colors.background};
  color: ${({ theme }) => theme.colors.textPrimary};
  font: inherit;
  cursor: pointer;
`;

const SaveButton = styled(SmallButton)`
  min-height: 36px;
  border-color: ${({ theme }) => theme.colors.primary}88;
  background: ${({ theme }) => theme.colors.primary}18;
  font-weight: 700;
  &:disabled { cursor: not-allowed; opacity: 0.55; }
`;

const Hint = styled.div`
  color: ${({ theme }) => theme.colors.textSecondary};
  line-height: 1.45;
`;

const SavedEntry = styled.article`
  display: grid;
  gap: 4px;
  padding: 8px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 8px;
  line-height: 1.4;
`;

interface ExperimentObservationNodeProps {
  data: {
    label?: string;
    sourceBindingGroup?: string;
  };
}

export const ExperimentObservationNode: React.FC<ExperimentObservationNodeProps> = ({ data }) => {
  const dispatch = useAppDispatch();
  const notes = useAppSelector(selectNoteCards);
  const knownLabels = useAppSelector(selectExperimentLabels);
  const activeSignalArea = useAppSelector((state) => state.spectrum.activeSignalArea);
  const txPattern = useAppSelector((state) => state.spectrum.txSignal);
  const txPowerDbm = useAppSelector((state) => state.spectrum.txPowerDbm);
  const txCenterFrequencyHz = useAppSelector((state) => state.spectrum.txCenterFrequencyHz);
  const txBandwidthHz = useAppSelector((state) => state.spectrum.txSampleRateHz);
  const txVgaGainDb = useAppSelector((state) => state.spectrum.txVgaGain);
  const txAmpEnabled = useAppSelector((state) => state.spectrum.hackrfAmpEnabled);
  const txSafetyEnabled = useAppSelector((state) => state.spectrum.txSafetyEnabled);
  const [title, setTitle] = useState("");
  const [observation, setObservation] = useState("");
  const [labelDraft, setLabelDraft] = useState("");
  const [labels, setLabels] = useState<string[]>([]);

  const addLabel = (raw: string) => {
    const next = normalizeExperimentLabels([...labels, raw]);
    setLabels(next);
    if (next.length > labels.length) {
      const added = next.find((label) => !labels.includes(label));
      if (added) dispatch(addExperimentLabel(added));
    }
    setLabelDraft("");
  };
  const removeLabel = (label: string) => setLabels((current) => current.filter((item) => item !== label));
  const saveObservation = async () => {
    const savedTitle = title.trim() || `Tx ${txPattern} · Channel ${activeSignalArea ?? "unknown"}`;
    await dispatch(
      createNoteCardFromSpectrum({
        title: savedTitle,
        observation: observation.trim(),
        labels,
        experiment: {
          channel: /^[ABC]$/i.test(activeSignalArea ?? "") ? activeSignalArea!.toUpperCase() : null,
          txPattern,
          txPowerDbm,
          txCenterFrequencyHz,
          txBandwidthHz,
          txVgaGainDb,
          txAmpEnabled,
          txSafetyEnabled,
        },
        snapshot: captureExperimentFftSnapshot(),
      }),
    );
    setTitle("");
    setObservation("");
    setLabelDraft("");
    setLabels([]);
  };

  return (
    <Card aria-label={data.label ?? "Experiment observation"}>
      <Header><ClipboardPlus size={16} />{data.label ?? "Observation log"}</Header>
      <Hint>
        Record what changed in the receive spectrum after this Tx condition.
        Keep observations separate from hypotheses.
      </Hint>
      <Field aria-label="Observation title" placeholder="Condition or observation title" value={title} onChange={(event) => setTitle(event.currentTarget.value)} />
      <Observation aria-label="Observed spectral features" placeholder="Feature appeared, disappeared, shifted, or stayed unchanged; include uncertainty and comparison baseline." value={observation} onChange={(event) => setObservation(event.currentTarget.value)} />
      <Field
        aria-label="Add experiment label"
        placeholder="Type a label and press Enter"
        value={labelDraft}
        onChange={(event) => setLabelDraft(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            addLabel(labelDraft);
          }
        }}
      />
      {knownLabels.length > 0 && (
        <div>
          <Hint>Saved labels</Hint>
          <LabelPills aria-label="Restored experiment labels">
            {knownLabels.filter((label) => !labels.includes(label)).map((label) => (
              <SmallButton key={label} type="button" onClick={() => addLabel(label)}>{label}</SmallButton>
            ))}
          </LabelPills>
        </div>
      )}
      {labels.length > 0 && (
        <LabelPills aria-label="Experiment label pills">
          {labels.map((label) => <Pill key={label}>{label}<button type="button" aria-label={`Remove label ${label}`} onClick={() => removeLabel(label)}>×</button></Pill>)}
        </LabelPills>
      )}
      <Hint>
        Saving stores the note, labels, Tx pattern and power, channel, receiver settings, and the visible Rx FFT snapshot in IndexedDB.
      </Hint>
      <SaveButton type="button" disabled={!observation.trim()} onClick={() => void saveObservation()}>
        Save observation and snapshot
      </SaveButton>
      {notes.some((note) => note.observation) && (
        <div>
          <Hint>Saved observations · restored from IndexedDB</Hint>
          <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
            {[...notes].reverse().filter((note) => note.observation).slice(0, 5).map((note) => (
              <SavedEntry key={note.id}>
                <strong>{note.title || "Untitled observation"}</strong>
                <span>{note.observation}</span>
                {note.experiment && (
                  <Hint>
                    Channel {note.experiment.channel ?? "unspecified"} · Tx {note.experiment.txPattern} · {note.experiment.txPowerDbm} dBm
                  </Hint>
                )}
                {!!note.labels?.length && (
                  <LabelPills aria-label={`Saved labels for ${note.title || "observation"}`}>
                    {note.labels.map((label) => <Pill key={label}>{label}</Pill>)}
                  </LabelPills>
                )}
              </SavedEntry>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
};
