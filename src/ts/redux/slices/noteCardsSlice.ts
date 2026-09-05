import {
  createSlice,
  createAsyncThunk,
  nanoid,
  PayloadAction,
} from "@reduxjs/toolkit";
import type { RootState } from "@n-apt/redux/store";
import type { PowerScale } from "@n-apt/redux/slices/spectrumSlice";
import type { SourceMode } from "@n-apt/redux/slices/waterfallSlice";
import { formatFrequency } from "@n-apt/math/frequency";
import { calculateCenterFrequency } from "@n-apt/math/centerFrequency";
import type { TemporalResolution } from "@n-apt/math/temporalResolution";

type SpectrumSliceState = RootState["spectrum"];
type WaterfallSliceState = RootState["waterfall"];

export interface NoteCardStatsSnapshot {
  centerFrequencyHz: number | null;
  frequencyRange: SpectrumSliceState["frequencyRange"];
  vizZoom: number;
  vizPanOffset: number;
  fftSize: number;
  fftWindow: string;
  fftFrameRate: number;
  temporalResolution: TemporalResolution;
  powerScale: PowerScale;
  fftDbMin: number;
  fftDbMax: number;
  sourceMode: SourceMode;
  gain: number;
  ppm: number;
  tunerAGC: boolean;
  rtlAGC: boolean;
  sampleRateHz: number;
  heterodyningStatusText: string;
  heterodyningDetected: boolean;
  createdAt: number;
}

export interface NoteCardSnapshotMedia {
  dataUrl: string;
  width: number;
  height: number;
}

export interface NoteCardPosition {
  x: number;
  y: number;
}

export interface NoteCardSize {
  width: number;
  height: number;
}

export interface NoteCardModel {
  id: string;
  title: string;
  stats: NoteCardStatsSnapshot;
  snapshot?: NoteCardSnapshotMedia | null;
  position: NoteCardPosition;
  size: NoteCardSize;
  zIndex: number;
  isActive: boolean;
}

interface NoteCardsState {
  cards: NoteCardModel[];
  activeCardId: string | null;
  nextZIndex: number;
  isCollapsed: boolean;
}

const DEFAULT_POSITION: NoteCardPosition = { x: 120, y: 80 };
const DEFAULT_SIZE: NoteCardSize = { width: 320, height: 400 };

const formatFrequencyText = (hz: number | null): string => {
  if (!Number.isFinite(hz ?? Number.NaN)) {
    return "Unavailable";
  }
  return formatFrequency(hz ?? 0, { precisionMHz: 3 });
};

const normalizePowerScale = (value: unknown): PowerScale =>
  value === "dBm" ? "dBm" : "dB";

const normalizeNoteCardStats = (
  stats: Partial<NoteCardStatsSnapshot>,
): NoteCardStatsSnapshot => ({
  centerFrequencyHz: Number.isFinite(stats.centerFrequencyHz ?? Number.NaN)
    ? (stats.centerFrequencyHz as number)
    : calculateCenterFrequency(stats.frequencyRange ?? null),
  frequencyRange: stats.frequencyRange ?? null,
  vizZoom: Number.isFinite(stats.vizZoom ?? Number.NaN)
    ? (stats.vizZoom as number)
    : 1,
  vizPanOffset: Number.isFinite(stats.vizPanOffset ?? Number.NaN)
    ? (stats.vizPanOffset as number)
    : 0,
  fftSize: Number.isFinite(stats.fftSize ?? Number.NaN)
    ? (stats.fftSize as number)
    : 0,
  fftWindow: typeof stats.fftWindow === "string" ? stats.fftWindow : "",
  fftFrameRate: Number.isFinite(stats.fftFrameRate ?? Number.NaN)
    ? (stats.fftFrameRate as number)
    : 0,
    temporalResolution: stats.temporalResolution ?? "slow",
  powerScale: normalizePowerScale(stats.powerScale),
  fftDbMin: Number.isFinite(stats.fftDbMin ?? Number.NaN)
    ? (stats.fftDbMin as number)
    : -120,
  fftDbMax: Number.isFinite(stats.fftDbMax ?? Number.NaN)
    ? (stats.fftDbMax as number)
    : 0,
  sourceMode: stats.sourceMode ?? "live",
  gain: Number.isFinite(stats.gain ?? Number.NaN) ? (stats.gain as number) : 0,
  ppm: Number.isFinite(stats.ppm ?? Number.NaN) ? (stats.ppm as number) : 0,
  tunerAGC: Boolean(stats.tunerAGC),
  rtlAGC: Boolean(stats.rtlAGC),
  sampleRateHz: Number.isFinite(stats.sampleRateHz ?? Number.NaN)
    ? (stats.sampleRateHz as number)
    : 0,
  heterodyningStatusText:
    typeof stats.heterodyningStatusText === "string"
      ? stats.heterodyningStatusText
      : "Unknown",
  heterodyningDetected: Boolean(stats.heterodyningDetected),
  createdAt: Number.isFinite(stats.createdAt ?? Number.NaN)
    ? (stats.createdAt as number)
    : Date.now(),
});

const normalizeNoteCardTitle = (card: NoteCardModel): string => {
  const title = card.title?.trim() ?? "";
  if (!title || title.includes("undefined")) {
    return "";
  }
  return title;
};

export const buildNoteCardTitle = (stats: NoteCardStatsSnapshot): string => {
  const centerText = formatFrequencyText(stats.centerFrequencyHz);
  const zoomText = Number.isFinite(stats.vizZoom)
    ? `${stats.vizZoom.toFixed(1)}x`
    : "Unknown zoom";
  const dbText =
    Number.isFinite(stats.fftDbMin) && Number.isFinite(stats.fftDbMax)
      ? `${stats.fftDbMin} to ${stats.fftDbMax} ${stats.powerScale}`
      : `Spectrum ${stats.powerScale}`;

  return `${centerText} · ${zoomText} · ${dbText}`;
};

const initialState: NoteCardsState = {
  cards: [],
  activeCardId: null,
  nextZIndex: 1,
  isCollapsed: false,
};

export const buildStatsSnapshot = (
  spectrum: SpectrumSliceState,
  waterfall: WaterfallSliceState,
): NoteCardStatsSnapshot => {
  const range = spectrum.frequencyRange;
  const centerFrequencyHz = calculateCenterFrequency(range);

  return {
    centerFrequencyHz,
    frequencyRange: range,
    vizZoom: spectrum.vizZoom,
    vizPanOffset: spectrum.vizPanOffset,
    fftSize: spectrum.fftSize,
    fftWindow: spectrum.fftWindow,
    fftFrameRate: spectrum.fftFrameRate,
    temporalResolution: spectrum.displayTemporalResolution,
    powerScale: spectrum.powerScale,
    fftDbMin: spectrum.fftMinDb,
    fftDbMax: spectrum.fftMaxDb,
    sourceMode: waterfall.sourceMode as SourceMode,
    gain: spectrum.gain,
    ppm: spectrum.ppm,
    tunerAGC: spectrum.tunerAGC,
    rtlAGC: spectrum.rtlAGC,
    sampleRateHz: spectrum.sampleRateHz,
    heterodyningStatusText:
      waterfall.sourceMode === "file" ? "Unavailable" : "Unknown",
    heterodyningDetected: false,
    createdAt: Date.now(),
  };
};

interface CreateNoteCardArgs {
  title?: string;
  snapshot?: NoteCardSnapshotMedia | null;
  stats?: Partial<NoteCardStatsSnapshot>;
}

export const createNoteCardFromSpectrum = createAsyncThunk<
  NoteCardModel,
  CreateNoteCardArgs | undefined,
  { state: RootState }
>("noteCards/createFromSpectrum", async (args, { getState }) => {
  const { spectrum, waterfall } = getState();
  const stats = normalizeNoteCardStats({
    ...buildStatsSnapshot(spectrum, waterfall),
    ...args?.stats,
  });
  const card: NoteCardModel = {
    id: nanoid(),
    title: args?.title ?? "",
    stats,
    snapshot: args?.snapshot ?? null,
    position: DEFAULT_POSITION,
    size: DEFAULT_SIZE,
    zIndex: 0,
    isActive: true,
  };
  return card;
});

const noteCardsSlice = createSlice({
  name: "noteCards",
  initialState,
  reducers: {
    hydrateNoteCards: (state, action: PayloadAction<NoteCardModel[]>) => {
      const incoming = action.payload ?? [];
      state.cards = incoming.map((card) => {
        const stats = normalizeNoteCardStats(card.stats);
        return {
          ...card,
          title: normalizeNoteCardTitle(card),
          stats,
          position: card.position ?? DEFAULT_POSITION,
          size: card.size ?? DEFAULT_SIZE,
        };
      });
      if (state.cards.length === 0) {
        state.activeCardId = null;
        state.nextZIndex = 1;
        return;
      }

      let maxZ = 0;
      let activeId: string | null = null;
      state.cards.forEach((card) => {
        maxZ = Math.max(maxZ, card.zIndex);
        if (card.isActive) {
          activeId = card.id;
        }
      });
      state.activeCardId = activeId ?? state.cards[state.cards.length - 1].id;
      state.nextZIndex = maxZ + 1;
    },
    updateNoteCardText: (
      state,
      action: PayloadAction<{ id: string; title: string }>,
    ) => {
      const card = state.cards.find((c) => c.id === action.payload.id);
      if (card) {
        card.title = action.payload.title;
      }
    },
    updateNoteCardPosition: (
      state,
      action: PayloadAction<{ id: string; position: NoteCardPosition }>,
    ) => {
      const card = state.cards.find((c) => c.id === action.payload.id);
      if (card) {
        card.position = action.payload.position;
      }
    },
    updateNoteCardSize: (
      state,
      action: PayloadAction<{ id: string; size: NoteCardSize }>,
    ) => {
      const card = state.cards.find((c) => c.id === action.payload.id);
      if (card) {
        if (
          card.size.width === action.payload.size.width &&
          card.size.height === action.payload.size.height
        ) {
          return;
        }
        card.size = action.payload.size;
      }
    },
    attachNoteCardSnapshot: (
      state,
      action: PayloadAction<{ id: string; snapshot: NoteCardSnapshotMedia }>,
    ) => {
      const card = state.cards.find((c) => c.id === action.payload.id);
      if (card) {
        card.snapshot = action.payload.snapshot;
      }
    },
    setActiveNoteCard: (state, action: PayloadAction<string>) => {
      if (state.activeCardId === action.payload) return;
      state.cards.forEach((card) => {
        card.isActive = card.id === action.payload ? true : false;
      });
      const activeCard = state.cards.find((c) => c.id === action.payload);
      if (activeCard) {
        activeCard.zIndex = state.nextZIndex++;
        state.activeCardId = activeCard.id;
      }
    },
    removeNoteCard: (state, action: PayloadAction<string>) => {
      state.cards = state.cards.filter((c) => c.id !== action.payload);
      if (state.activeCardId === action.payload) {
        state.activeCardId = state.cards.length
          ? state.cards[state.cards.length - 1].id
          : null;
        if (state.activeCardId) {
          const newActive = state.cards.find(
            (c) => c.id === state.activeCardId,
          );
          if (newActive) {
            newActive.isActive = true;
          }
        }
      }
    },
    clearNoteCards: (state) => {
      state.cards = [];
      state.activeCardId = null;
      state.nextZIndex = 1;
      state.isCollapsed = false;
    },
    setNoteCardsCollapsed: (state, action: PayloadAction<boolean>) => {
      state.isCollapsed = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder.addCase(createNoteCardFromSpectrum.fulfilled, (state, action) => {
      const cardPayload = action.payload;
      state.cards.forEach((card) => {
        if (card.isActive) {
          card.isActive = false;
        }
      });
      const zIndex = state.nextZIndex++;
      state.cards.push({ ...cardPayload, zIndex });
      state.activeCardId = cardPayload.id;
    });
  },
});

export const {
  hydrateNoteCards,
  updateNoteCardText,
  updateNoteCardPosition,
  updateNoteCardSize,
  attachNoteCardSnapshot,
  setActiveNoteCard,
  removeNoteCard,
  clearNoteCards,
  setNoteCardsCollapsed,
} = noteCardsSlice.actions;

export const selectNoteCardsState = (state: RootState) => state.noteCards;
export const selectNoteCards = (state: RootState) => state.noteCards.cards;
export const selectActiveNoteCard = (state: RootState) =>
  state.noteCards.cards.find(
    (card) => card.id === state.noteCards.activeCardId,
  ) ?? null;
export const selectNoteCardsCollapsed = (state: RootState) =>
  state.noteCards.isCollapsed;

export default noteCardsSlice.reducer;
