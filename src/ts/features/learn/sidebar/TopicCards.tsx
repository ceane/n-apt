import React from "react";
import styled from "styled-components";
import { useModel3D } from "@n-apt/three-d/public/useModel3D";
import { BRAIN_ANATOMY_CARDS, NERVOUS_SYSTEM_CARDS, toModelArea } from "@n-apt/learn/sidebar/AnatomyCardsSection";
import { PHYSIOLOGY_AREAS } from "@n-apt/learn/sidebar/BodyAreasSection";

type TopicSection = "physiology" | "psychology" | "behavior" | "effects";
type TopicCardData = { title: string; summary: string; detail: string; tags: string[]; related: string[] };

const TOPICS: Record<TopicSection, TopicCardData[]> = {
  physiology: [
    { title: "Tactile sensation", summary: "Touch and skin sensation", detail: "Tactile sensation includes touch, pressure, vibration, texture, and related skin signals. Sensory changes can include reduced sensation, numbness, tingling, hypersensitivity, or altered texture perception; this card describes categories, not a diagnosis.", tags: ["touch", "tactile", "skin", "somatosensory", "numbness", "tingling", "pins and needles", "hypersensitivity", "pressure", "vibration", "texture", "feel", "feeling", "sensory loss", "paresthesia"], related: ["Primary somatosensory cortex", "Somatosensory association cortex", "Cutaneous receptors", "Hands (Left)", "Hands (Right)"] },
    { title: "Perception", summary: "How sensory signals become an interpreted experience", detail: "Perception combines incoming sensory information with attention, memory, expectations, and context. A changed perception can have many possible causes; a single experience does not identify one brain area or mechanism.", tags: ["perceive", "perception", "sensory processing", "interpretation", "awareness", "body awareness", "spatial", "visual", "auditory", "hearing", "sound", "touch", "tactile", "integration", "recognition", "misperception"], related: ["Thalamus", "Insula", "Somatosensory association cortex", "Visual association cortex", "Primary auditory cortex"] },
    { title: "Speech and voice", summary: "Speech movement, language, and voice production", detail: "Speaking depends on coordinated language, breathing, voice, hearing, and motor systems. Changes can affect word finding, speech clarity, voice, or fluency; these features are distinct and can have different causes.", tags: ["speech", "speaking", "talking", "voice", "phonation", "larynx", "vocal cords", "vocal folds", "language", "word finding", "aphasia", "dysarthria", "communication", "singing", "breathing"], related: ["Broca region", "Primary motor cortex", "Vocal Cords", "Throat", "Primary auditory cortex"] },
    { title: "Movement and expression limits", summary: "Reduced or restricted movement", detail: "Weakness (paresis) means reduced muscle strength; paralysis (plegia) means loss of voluntary movement in affected muscles. Restricted movement can also come from pain, stiffness, fatigue, or other causes. These terms describe different findings and need clinical assessment to identify a cause.", tags: ["movement", "motor", "weakness", "paresis", "paralysis", "plegia", "restricted movement", "limited movement", "mobility", "immobility", "motor impairment", "expression", "facial movement", "muscle weakness", "loss of movement"], related: ["Primary motor cortex", "Corticospinal tract", "Spinal cord", "Biceps brachii", "Zygomaticus major"] },
    { title: "Wellness and body regulation", summary: "Whole-body systems that support daily function", detail: "Wellness is broad and can include sleep, energy, pain, activity, and social context. The nervous system helps regulate body functions, but no single area or chemical determines overall wellness.", tags: ["wellness", "wellbeing", "well-being", "health", "sleep", "energy", "fatigue", "stress", "autonomic", "homeostasis", "body regulation", "daily function", "balance", "comfort"], related: ["Hypothalamus", "Autonomic nervous system", "Reticular formation", "Heart", "Torso"] },
  ],
  psychology: [
    { title: "Emotional experience", summary: "Feelings, affect, and emotional regulation", detail: "Emotional experience involves interacting brain networks, body signals, prior learning, and context. Feeling an emotion, showing an expression, and regulating a response are related but not identical processes.", tags: ["emotion", "emotional", "feelings", "mood", "happiness", "happy", "joy", "sadness", "sad", "anger", "angry", "fear", "anxiety", "distress", "regulation", "affect", "expression"], related: ["Emotion and affective networks", "Amygdala", "Insula", "Cingulate cortex", "Ventromedial prefrontal cortex"] },
  ],
  behavior: [
    { title: "Behavior", summary: "Actions and responses shaped by brain, body, learning, and context", detail: "Behavior includes observable actions, habits, speech, and responses to situations. It emerges from interacting biological and environmental influences; one action or behavior pattern cannot by itself establish a particular brain state or cause.", tags: ["behavior", "behaviour", "action", "actions", "habit", "habits", "choice", "response", "learning", "motivation", "social behavior", "expression", "speech", "movement", "avoidance", "approach", "attention", "context"], related: ["Prefrontal cortex", "Basal ganglia", "Hippocampus", "Emotion and affective networks", "Primary motor cortex"] },
    { title: "Habits and action learning", summary: "Learning repeated actions and selecting what to do", detail: "Repeated behavior can become more automatic through learning and practice. Basal ganglia, cortical, and other networks contribute to habit formation and action selection; habits remain influenced by goals and context.", tags: ["habit formation", "automatic behavior", "practice", "reinforcement", "action selection", "routine", "motor learning", "reward", "motivation", "decision", "behavior change"], related: ["Basal ganglia", "Caudate nucleus", "Putamen", "Dopamine", "Prefrontal cortex"] },
  ],
  effects: [
    { title: "Sexual assault", summary: "Health context and possible responses", detail: "Sexual assault is a form of sexual violence involving sexual contact or activity without consent. Possible health effects vary widely and can be physical, emotional, or social; there is no single response pattern. This educational card is not a way to determine whether an assault occurred or to diagnose an individual.", tags: ["sexual assault", "sexual violence", "nonconsensual", "without consent", "trauma", "survivor", "physical effects", "emotional effects", "stress response", "health impact", "safety", "consent"], related: ["Emotion and affective networks", "Amygdala", "Insula", "Hypothalamus", "Sacral spinal cord (S1–S5)"] },
    { title: "Epigenetic regulation", summary: "How gene regulation can shift over time", detail: "Epigenetic processes can alter how cells use genes over time, sometimes in response to environmental conditions, development, or stress-related signals. Some changes can be durable while others are more flexible; effects differ by cell and tissue. These processes can change gene activity without changing the DNA sequence, and a general association does not establish an individual's cause or outcome.", tags: ["epigenetic", "epigenetics", "epigenome", "gene expression", "gene regulation", "gene activity", "genes over time", "DNA methylation", "histone modification", "chromatin", "environment", "environmental pressure", "stress", "stress response", "experience", "biology", "cell regulation", "durable", "persistent", "reversible"], related: ["Hypothalamus", "Hippocampus", "Amygdala", "Cingulate cortex"] },
  ],
};

const CardList = styled.div`display: grid; grid-column: 1 / -1; gap: 8px;`;
const TopicTile = styled.article`display: grid; gap: 5px; padding: 10px 12px; border: 1px solid ${(p) => p.theme.border}; border-radius: 8px; background: ${(p) => p.theme.surface};`;
const Title = styled.strong`font-size: 11px; color: ${(p) => p.theme.textPrimary};`;
const Summary = styled.span`font-size: 10px; color: ${(p) => p.theme.textSecondary};`;
const Detail = styled.p`margin: 0; font-size: 10px; line-height: 1.45; color: ${(p) => p.theme.textSecondary};`;
const Related = styled.div`display: flex; flex-wrap: wrap; gap: 5px; align-items: center;`;
const RelatedTitle = styled.strong`font-size: 9px; color: ${(p) => p.theme.textMuted}; text-transform: uppercase; letter-spacing: .04em;`;
const AreaButton = styled.button`border: 0; padding: 0; background: transparent; color: ${(p) => p.theme.primary}; cursor: pointer; font: inherit; font-size: 9px; &:hover { text-decoration: underline; }`;
const Empty = styled.div`padding: 10px; font-size: 10px; color: ${(p) => p.theme.textSecondary};`;

export const TopicCards: React.FC<{ section: TopicSection; searchTerm: string }> = ({ section, searchTerm }) => {
  const { setSelectedArea, setModelVariant } = useModel3D();
  const query = searchTerm.trim().toLowerCase();
  const cards = TOPICS[section].filter((card) => `${card.title} ${card.summary} ${card.detail} ${card.tags.join(" ")} ${card.related.join(" ")}`.toLowerCase().includes(query));
  const focusArea = (name: string) => {
    const bodyArea = PHYSIOLOGY_AREAS.find((area) => area.name === name);
    if (bodyArea) {
      setSelectedArea(bodyArea);
      setModelVariant("human");
      return;
    }
    const anatomyCard = [...BRAIN_ANATOMY_CARDS, ...NERVOUS_SYSTEM_CARDS].find((card) => card.name === name);
    if (anatomyCard) {
      setSelectedArea(toModelArea(anatomyCard));
      setModelVariant(anatomyCard.model);
    }
  };

  if (!cards.length) return query ? <Empty>No {section} topic tiles match “{searchTerm}”.</Empty> : null;
  return <CardList>{cards.map((card) => <TopicTile key={card.title}><Title>{card.title}</Title><Summary>{card.summary}</Summary><Detail>{card.detail}</Detail><Related><RelatedTitle>Related areas</RelatedTitle>{card.related.map((name) => <AreaButton key={name} type="button" onClick={() => focusArea(name)}>{name}</AreaButton>)}</Related></TopicTile>)}</CardList>;
};
