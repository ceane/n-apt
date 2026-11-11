import React, { useEffect } from "react";
import styled from "styled-components";
import { gsap } from "gsap";
import { BRAIN_POSITION, BRAIN_SCALE, MODEL_ROOT_POSITION } from "@n-apt/consts";
import { useModel3D, type Area } from "@n-apt/three-d/public/useModel3D";

type AnatomyCardData = {
  name: string;
  group: string;
  description: string;
  function: string;
  model: "brain" | "human";
  offset: [number, number, number];
};

const brain = (name: string, group: string, description: string, fn: string, offset: [number, number, number]): AnatomyCardData => ({ name, group, description, function: fn, model: "brain", offset });
const nerve = (name: string, group: string, description: string, fn: string, offset: [number, number, number] = [0, 0, 0]): AnatomyCardData => ({ name, group, description, function: fn, model: "human", offset });
const BRAIN_GLB_NODE_TRANSLATION = [-0.31977856, 1.750008, -0.5486296] as const;

// These are educational regions, not one-to-one anatomical boundaries. Many
// functional networks cross the named structures shown here.
export const BRAIN_ANATOMY_CARDS: AnatomyCardData[] = [
  brain("Frontal lobe", "Cerebral lobes", "Anterior cerebral cortex, in front of the central sulcus.", "Planning, voluntary movement, decision-making, working memory, and aspects of behavior and speech.", [0, .09, .12]),
  brain("Prefrontal cortex", "Cerebral lobes", "The association cortex at the front of the frontal lobes.", "Executive control, planning, attention, working memory, behavioral regulation, and flexible decision-making.", [0, .13, .16]),
  brain("Dorsolateral prefrontal cortex", "Cerebral lobes", "Lateral portions of the middle and inferior frontal gyri.", "Maintains and manipulates information, supports goal-directed attention, and helps organize multi-step actions.", [.11, .12, .08]),
  brain("Ventromedial prefrontal cortex", "Cerebral lobes", "Medial and lower prefrontal cortex, including parts of orbitofrontal cortex.", "Integrates value, emotion, and context during decisions; contributes to social judgment and regulation.", [0, .03, .16]),
  brain("Orbitofrontal cortex", "Cerebral lobes", "Cortex on the underside of the frontal lobes above the eye sockets.", "Evaluates reward, risk, and changing outcomes; helps adjust behavior when choices stop working.", [0, -.02, .17]),
  brain("Primary motor cortex", "Cerebral lobes", "Precentral gyrus, immediately in front of the central sulcus.", "Sends commands for voluntary movement. The body is represented in an approximate motor map, with extensive overlap.", [.13, .08, 0]),
  brain("Premotor cortex", "Cerebral lobes", "Lateral frontal cortex just anterior to primary motor cortex.", "Selects and prepares movements, especially movements guided by external cues.", [.12, .1, .04]),
  brain("Supplementary motor area", "Cerebral lobes", "Medial superior frontal cortex in front of primary motor cortex.", "Helps plan internally generated movement sequences and coordinate both sides of the body.", [0, .13, -.01]),
  brain("Broca region", "Cerebral lobes", "Usually in the left inferior frontal gyrus; language is distributed across a wider network.", "Contributes to speech production, language sequencing, and aspects of grammatical processing.", [.12, .035, .12]),
  brain("Parietal lobe", "Cerebral lobes", "Cortex behind the central sulcus and above the lateral sulcus.", "Combines touch and body-position signals with spatial attention and action planning.", [0, .09, -.08]),
  brain("Primary somatosensory cortex", "Cerebral lobes", "Postcentral gyrus, just behind the central sulcus.", "Receives and maps touch, vibration, pain, temperature, and body-position information from the opposite side.", [.13, .07, -.035]),
  brain("Somatosensory association cortex", "Cerebral lobes", "Posterior parietal cortex behind primary somatosensory areas.", "Interprets combined sensory input for object recognition, body awareness, and guided movement.", [.12, .1, -.12]),
  brain("Posterior parietal cortex", "Cerebral lobes", "Upper and lower parietal association regions.", "Supports spatial attention, reaching, eye-hand coordination, and integration of sensory information.", [.12, .12, -.1]),
  brain("Temporal lobe", "Cerebral lobes", "Lateral cortex below the lateral sulcus.", "Important for hearing, language comprehension, memory, object recognition, and emotional associations.", [.12, -.01, -.1]),
  brain("Primary auditory cortex", "Cerebral lobes", "Heschl gyri on the upper surface of the temporal lobe.", "Processes basic features of sound; inputs and higher auditory functions are distributed across both hemispheres.", [.13, .01, -.04]),
  brain("Wernicke region", "Cerebral lobes", "A traditional label near posterior superior temporal cortex, usually left-sided.", "Supports language comprehension as part of a broader temporal, parietal, and frontal language network.", [.13, .04, -.12]),
  brain("Medial temporal lobe", "Cerebral lobes", "Inner temporal structures including hippocampal and parahippocampal regions.", "Supports formation and retrieval of episodic memories and navigation-related representations.", [.04, -.04, -.11]),
  brain("Occipital lobe", "Cerebral lobes", "Posterior cerebral cortex, at the back of the brain.", "Processes visual information through multiple areas for edges, color, motion, and visual form.", [0, .02, -.19]),
  brain("Primary visual cortex", "Cerebral lobes", "Calcarine cortex in the medial occipital lobe.", "Receives early visual input and represents visual-field location; further interpretation uses connected regions.", [0, .01, -.18]),
  brain("Visual association cortex", "Cerebral lobes", "Occipital and neighboring temporal and parietal visual areas.", "Combines visual features to support recognition, motion perception, and spatial interpretation.", [.08, .03, -.17]),
  brain("Insula", "Cerebral lobes", "Cortex folded deep within the lateral sulcus.", "Integrates internal-body signals with taste, pain, emotion, and salience processing.", [.15, -.015, .005]),
  brain("Cingulate cortex", "Cerebral lobes", "Medial cortex arching above the corpus callosum.", "Participates in attention, motivation, emotion, pain processing, and monitoring actions and outcomes.", [0, .11, -.045]),
  brain("Corpus callosum", "Deep brain structures", "The largest bundle of fibers connecting the cerebral hemispheres.", "Allows information to pass between hemispheres; it is white matter, not a single functional center.", [0, .02, 0]),
  brain("Thalamus", "Deep brain structures", "Paired deep gray-matter structures above the brainstem.", "Relays and coordinates most sensory and motor information with the cortex and supports alertness.", [0, -.04, .005]),
  brain("Hypothalamus", "Deep brain structures", "Small region beneath the thalamus, connected to the pituitary.", "Regulates temperature, hunger, thirst, circadian timing, hormonal control, and autonomic responses.", [0, -.09, .035]),
  brain("Hippocampus", "Deep brain structures", "Curved medial temporal structure on each side.", "Helps form new episodic and spatial memories; it is not a storage location for every memory.", [.04, -.055, -.1]),
  brain("Amygdala", "Deep brain structures", "Nuclei in the medial temporal lobe, near the hippocampus.", "Helps learn and evaluate emotional significance, especially threat and reward, with broad network connections.", [.065, -.035, -.085]),
  brain("Basal ganglia", "Deep brain structures", "A group of deep nuclei including the caudate, putamen, and globus pallidus.", "Helps select and scale actions, learn habits, and support movement and cognitive loops.", [.07, -.025, .01]),
  brain("Caudate nucleus", "Deep brain structures", "C-shaped basal ganglia structure alongside the lateral ventricle.", "Contributes to action selection, learning, and cognitive control loops.", [.07, .005, .055]),
  brain("Putamen", "Deep brain structures", "Lateral part of the striatum, beside the globus pallidus.", "Participates in movement selection, motor learning, and habit-related circuits.", [.09, -.035, .005]),
  brain("Substantia nigra", "Deep brain structures", "Dopamine-producing and output nuclei in the midbrain.", "Modulates basal ganglia circuits involved in movement, motivation, and reinforcement learning.", [.025, -.12, .035]),
  brain("Cerebellum", "Cerebellum and brainstem", "Highly folded structure behind the brainstem and below the occipital lobes.", "Refines coordination, balance, timing, motor learning, and some cognitive processes.", [0, -.13, -.13]),
  brain("Vermis", "Cerebellum and brainstem", "Midline portion of the cerebellum.", "Contributes to posture, gait, balance, and coordination of trunk and eye movements.", [0, -.15, -.12]),
  brain("Brainstem", "Cerebellum and brainstem", "Midbrain, pons, and medulla between the cerebrum and spinal cord.", "Carries major pathways and supports arousal, breathing, cardiovascular control, and cranial nerve functions.", [0, -.14, .025]),
  brain("Midbrain", "Cerebellum and brainstem", "Upper brainstem between the diencephalon and pons.", "Supports eye movements, orienting to sound and sight, motor pathways, and arousal circuits.", [0, -.11, .04]),
  brain("Pons", "Cerebellum and brainstem", "Bulging middle part of the brainstem, in front of the cerebellum.", "Relays information to the cerebellum and participates in sleep, breathing, facial sensation, and movement.", [0, -.16, .04]),
  brain("Medulla oblongata", "Cerebellum and brainstem", "Lowest brainstem region, continuous with the spinal cord.", "Contains circuits essential for breathing, blood pressure, heart-rate regulation, swallowing, and protective reflexes.", [0, -.2, .035]),
  brain("Reticular formation", "Cerebellum and brainstem", "Distributed network through the brainstem.", "Helps regulate wakefulness, attention, sleep-wake transitions, and basic motor and autonomic functions.", [0, -.13, .045]),
  ...[
    [1,"Primary motor cortex", "Voluntary movement commands, especially fine movements of the opposite side."],
    [2,"Primary somatosensory cortex", "Touch, pressure, pain, temperature, and body-position processing."],
    [3,"Primary somatosensory cortex", "Major initial cortical receiving area for somatic sensory signals."],
    [4,"Primary motor cortex", "Execution of voluntary movement."],
    [5,"Somatosensory association cortex", "Integration of bodily sensation and movement guidance."],
    [6,"Premotor and supplementary motor cortex", "Motor planning and preparation."],
    [7,"Posterior parietal cortex", "Spatial integration and visually guided movement."],
    [8,"Frontal eye fields", "Voluntary eye movements and visual attention."],
    [9,"Dorsolateral prefrontal cortex", "Executive control and working memory."],
    [10,"Frontopolar cortex", "Prospective planning and managing complex goals."],
    [11,"Orbitofrontal cortex", "Value evaluation and flexible choice."],
    [17,"Primary visual cortex", "Early cortical processing of visual input."],
    [18,"Visual association cortex", "Visual feature integration."],
    [19,"Visual association cortex", "Higher visual processing and recognition."],
    [20,"Inferior temporal cortex", "Visual object recognition."],
    [21,"Middle temporal cortex", "Semantic and visual association processing."],
    [22,"Superior temporal cortex", "Auditory association and language comprehension network."],
    [37,"Fusiform region", "Recognition of complex visual forms, including faces and words."],
    [39,"Angular gyrus", "Language, reading, number, and multimodal association functions."],
    [40,"Supramarginal gyrus", "Phonological, sensory integration, and praxis functions."],
    [41,"Primary auditory cortex", "Early cortical analysis of sound."],
    [42,"Auditory association cortex", "Further analysis of auditory information."],
    [44,"Pars opercularis", "Part of the left-dominant speech and language production network."],
    [45,"Pars triangularis", "Part of the left-dominant language network."],
    [46,"Dorsolateral prefrontal cortex", "Working memory and executive control."],
    [47,"Inferior frontal cortex", "Language, semantic selection, and cognitive control."],
  ].map(([number, area, fn]) => brain(`Brodmann area ${number}`, "Brodmann areas", `${area} is the traditional cytoarchitectonic label for this cortical region. Borders and functions do not map perfectly one-to-one.`, String(fn), [0, .08, number === 17 || number === 18 || number === 19 ? -.16 : .09]) as AnatomyCardData),
];

export const NERVOUS_SYSTEM_CARDS: AnatomyCardData[] = [
  nerve("Central nervous system", "Organization", "Brain and spinal cord; the main site for integration of neural information.", "Combines sensory input, internal state, and prior learning to coordinate perception, thought, movement, and regulation.", [0, 1.85, 0]),
  nerve("Peripheral nervous system", "Organization", "Nerves and ganglia outside the brain and spinal cord.", "Connects the central nervous system with skin, muscles, joints, organs, and glands.", [0, 1.55, .4]),
  nerve("Somatic nervous system", "Organization", "Sensory pathways from skin and joints and motor pathways to skeletal muscle.", "Carries conscious sensation and supports voluntary movement as well as spinal reflexes.", [0, 1.6, .35]),
  nerve("Autonomic nervous system", "Organization", "Sympathetic, parasympathetic, and enteric pathways regulating internal organs.", "Adjusts organ activity, glands, smooth muscle, and cardiac muscle to changing conditions.", [0, 1.4, .2]),
  nerve("Sympathetic division", "Autonomic pathways", "Thoracolumbar autonomic outflow, with ganglia near the spine and major vessels.", "Mobilizes energy and adjusts heart, airway, pupil, sweat, and digestive activity; it is active beyond emergencies.", [0, 1.35, -.03]),
  nerve("Parasympathetic division", "Autonomic pathways", "Craniosacral outflow, including the vagus nerve and pelvic splanchnic nerves.", "Supports digestion, glandular secretion, and restorative functions while continually balancing other autonomic input.", [0, 1.28, .12]),
  nerve("Enteric nervous system", "Autonomic pathways", "Neural circuits embedded in the gastrointestinal tract wall.", "Coordinates gut movement, secretion, and local blood flow; it communicates with both autonomic divisions.", [0, 1.25, .35]),
  nerve("Spinal cord", "Spinal cord", "Neural tissue in the vertebral canal, continuing from the medulla; adult cord usually ends near L1–L2.", "Carries ascending sensory and descending motor pathways and coordinates segmental reflexes.", [0, 1.3, -.12]),
  nerve("Cervical spinal cord (C1–C8)", "Spinal cord", "Upper eight spinal nerve levels, within the neck region.", "Conveys sensation and movement for neck, diaphragm-related pathways, shoulders, arms, and hands.", [0, 1.72, -.08]),
  nerve("Thoracic spinal cord (T1–T12)", "Spinal cord", "Twelve spinal nerve levels associated with the trunk.", "Serves chest and abdominal wall and supplies much of the sympathetic outflow.", [0, 1.42, -.08]),
  nerve("Lumbar spinal cord (L1–L5)", "Spinal cord", "Five lumbar spinal nerve levels; lower roots travel below the cord as cauda equina.", "Contributes to sensation and movement of the lower trunk and front/inner leg.", [0, .98, -.08]),
  nerve("Sacral spinal cord (S1–S5)", "Spinal cord", "Five sacral spinal nerve levels, with roots continuing through the cauda equina.", "Serves posterior leg and foot, pelvic floor, bowel, bladder, and sexual functions.", [0, .73, -.08]),
  nerve("Cervical enlargement", "Spinal cord", "Widened cord region containing circuits for upper-limb pathways.", "Connects arm and hand sensory and motor pathways through cervical and upper thoracic roots.", [0, 1.58, -.08]),
  nerve("Lumbosacral enlargement", "Spinal cord", "Widened cord region supporting lower-limb pathways.", "Connects leg and foot sensory and motor pathways through lumbar and sacral roots.", [0, 1.12, -.08]),
  nerve("Dorsal root and sensory ganglion", "Spinal cord", "Sensory nerve fibers enter the spinal cord through dorsal roots; cell bodies sit in dorsal root ganglia.", "Carries touch, pain, temperature, and body-position signals toward spinal and brain circuits.", [0, 1.35, -.2]),
  nerve("Ventral root", "Spinal cord", "Motor axons leave the spinal cord through ventral roots.", "Carries commands to skeletal muscle and preganglionic autonomic pathways.", [0, 1.35, -.2]),
  ...[
    ["I Olfactory", "Smell", "Carries odor information from the nasal lining to olfactory brain circuits."],
    ["II Optic", "Vision", "Carries retinal visual information; it is a central nervous system tract rather than a typical peripheral nerve."],
    ["III Oculomotor", "Eye movement and pupil", "Moves most extraocular muscles, lifts the eyelid, and constricts the pupil."],
    ["IV Trochlear", "Eye movement", "Controls the superior oblique muscle, helping direct the eye downward when turned inward."],
    ["V Trigeminal", "Face sensation and chewing", "Main sensory supply of the face and motor supply to muscles of mastication."],
    ["VI Abducens", "Eye movement", "Controls the lateral rectus muscle, turning the eye outward."],
    ["VII Facial", "Facial movement and taste", "Controls facial expression, carries taste from the front tongue, and supplies tear and some salivary glands."],
    ["VIII Vestibulocochlear", "Hearing and balance", "Carries sound and balance information from the inner ear."],
    ["IX Glossopharyngeal", "Throat, taste, and visceral sensation", "Carries taste and sensation from the rear tongue and pharynx and supports swallowing and salivation."],
    ["X Vagus", "Visceral and throat pathways", "Carries sensory and motor fibers for the throat, voice, and many chest and abdominal organs."],
    ["XI Accessory", "Neck and shoulder movement", "Supplies sternocleidomastoid and trapezius muscles for head turning and shoulder elevation."],
    ["XII Hypoglossal", "Tongue movement", "Controls most tongue muscles used for speech, chewing, and swallowing."],
  ].map(([name, functionText], index) => nerve(`Cranial nerve ${name}`, "Cranial nerves", `Cranial nerve ${index + 1}; paired nerve emerging from the brain or brainstem.`, String(functionText), [0, 1.8 - index * .025, .4]) as AnatomyCardData),
  nerve("Brachial plexus", "Nerve plexuses", "Network formed mainly by C5–T1 spinal nerve roots.", "Distributes motor and sensory fibers to the shoulder, arm, forearm, and hand.", [.2, 1.6, .2]),
  nerve("Cervical plexus", "Nerve plexuses", "Network formed mainly by C1–C4 ventral rami in the neck.", "Supplies parts of the neck and contributes the phrenic nerve to the diaphragm.", [0, 1.72, .1]),
  nerve("Lumbar plexus", "Nerve plexuses", "Network formed mainly by L1–L4 ventral rami.", "Supplies the lower abdominal wall and much of the anterior and medial thigh.", [.1, 1.08, .15]),
  nerve("Sacral plexus", "Nerve plexuses", "Network formed mainly by L4–S4 ventral rami.", "Supplies much of the pelvis, posterior thigh, lower leg, and foot.", [0, .8, -.15]),
  nerve("Phrenic nerve", "Major peripheral nerves", "Arises mainly from C3–C5 cervical roots and descends to each hemidiaphragm.", "Provides the primary motor supply for diaphragm contraction and carries sensory fibers from nearby membranes.", [0, 1.45, .25]),
  nerve("Radial nerve", "Major peripheral nerves", "Major branch of the brachial plexus running along the posterior arm and forearm.", "Supplies many arm and wrist extensor muscles and sensation over parts of the posterior limb and hand.", [.25, 1.3, .12]),
  nerve("Median nerve", "Major peripheral nerves", "Brachial plexus nerve passing through the carpal tunnel into the hand.", "Supplies several forearm flexors and thumb-side hand muscles and sensation to parts of the palm and fingers.", [.2, 1.08, .15]),
  nerve("Ulnar nerve", "Major peripheral nerves", "Brachial plexus nerve passing behind the medial elbow to the hand.", "Supplies many small hand muscles and sensation to the little-finger side of the hand.", [.27, 1.0, .14]),
  nerve("Femoral nerve", "Major peripheral nerves", "Major lumbar plexus branch passing beneath the inguinal ligament.", "Supplies hip flexors and knee extensors and sensation to the anterior thigh and medial lower leg.", [.13, .82, .12]),
  nerve("Obturator nerve", "Major peripheral nerves", "Lumbar plexus branch passing through the obturator canal.", "Supplies most thigh adductors and sensation to a small area of medial thigh.", [.09, .78, .12]),
  nerve("Sciatic nerve", "Major peripheral nerves", "Largest peripheral nerve, formed by L4–S3 roots and traveling through the posterior thigh.", "Carries fibers for most muscles and skin below the knee through its tibial and common fibular branches.", [0, .72, -.2]),
  nerve("Tibial nerve", "Major peripheral nerves", "Sciatic branch descending through the posterior lower leg to the sole.", "Supplies posterior lower-leg and plantar foot muscles and sensation to much of the sole.", [0, .34, -.12]),
  nerve("Common fibular nerve", "Major peripheral nerves", "Sciatic branch wrapping around the fibular neck before dividing.", "Supplies anterior and lateral lower-leg pathways via its branches and sensation over much of the dorsum of the foot.", [.08, .35, -.07]),
  nerve("Vagus nerve pathway", "Major peripheral nerves", "Long cranial nerve extending from brainstem through the neck into the chest and abdomen.", "Provides extensive parasympathetic output and visceral sensory feedback; it does not control every organ function alone.", [0, 1.3, .2]),
  nerve("Superior laryngeal nerve", "Major peripheral nerves", "Branch of the vagus nerve that supplies sensation above the vocal folds and motor fibers to the cricothyroid muscle.", "Contributes to pitch control, voice sensation, and protective laryngeal reflexes.", [0, 1.73, .24]),
  nerve("Recurrent laryngeal nerve", "Major peripheral nerves", "Vagus nerve branch that loops in the chest and ascends to the larynx; the right and left courses differ.", "Supplies most intrinsic laryngeal muscles for vocal-fold movement and carries sensation below the vocal folds.", [0, 1.78, .22]),
  ...[
    ["C2", "Back of head and upper neck"], ["C3", "Side of neck"], ["C4", "Shoulder cape"], ["C5", "Outer upper arm"],
    ["C6", "Thumb side of forearm and hand"], ["C7", "Middle finger region"], ["C8", "Little-finger side of hand"],
    ["T1", "Inner forearm"], ["T4", "Approximate nipple-level band"], ["T6", "Upper abdominal band"], ["T10", "Approximate umbilical-level band"],
    ["L1", "Groin crease"], ["L2", "Front upper thigh"], ["L3", "Inner knee"], ["L4", "Inner lower leg and medial ankle"],
    ["L5", "Outer lower leg and top of foot"], ["S1", "Outer foot and posterior calf"], ["S2", "Posterior thigh"], ["S3–S5", "Perineal and saddle region"],
  ].map(([root, area]) => nerve(`Dermatome ${root}`, "Skin sensation maps", `Approximate skin territory associated with spinal sensory root ${root}; adjacent dermatomes overlap and maps vary.`, `Provides a clinical map for describing sensory changes around the ${area.toLowerCase()}. A dermatome is a root-based map, not a single named skin nerve.`, [0, 1.2, .2]) as AnatomyCardData),
  ...[
    ["Supraclavicular nerves", "Skin over the upper chest and shoulder"], ["Intercostal nerves", "Segmental skin bands across the chest and abdomen"],
    ["Lateral femoral cutaneous nerve", "Skin over the outer thigh"], ["Saphenous nerve", "Skin along the medial leg and foot"],
    ["Sural nerve", "Skin over the posterolateral lower leg and outer foot"], ["Superficial fibular nerve", "Most skin on the dorsum of the foot"],
    ["Ilioinguinal nerve", "Skin of the upper medial thigh and external genital region"], ["Posterior femoral cutaneous nerve", "Skin of the posterior thigh"],
  ].map(([name, area]) => nerve(name, "Skin sensation maps", `Named cutaneous peripheral nerve supplying a variable skin territory: ${area.toLowerCase()}.`, "Carries sensory information from its skin territory toward the spinal cord. Cutaneous nerve territories overlap and do not match dermatomes exactly.", [0, 1.1, .15]) as AnatomyCardData),
  nerve("Cutaneous receptors", "Skin sensation maps", "Free nerve endings and specialized endings in skin detect different kinds of stimuli.", "Encode touch, vibration, skin stretch, temperature, itch, and tissue-damaging stimuli for spinal and brain pathways.", [0, 1.45, .45]),
  nerve("Dorsal column–medial lemniscus pathway", "Sensory pathways", "Ascending spinal and brainstem pathway for discriminative touch and conscious proprioception.", "Carries vibration, fine touch, and position signals to the thalamus and sensory cortex, largely crossing in the medulla.", [0, 1.4, -.15]),
  nerve("Spinothalamic pathway", "Sensory pathways", "Anterolateral ascending pathway with early crossing in the spinal cord.", "Carries much of pain, temperature, itch, and crude touch information toward thalamic and cortical networks.", [0, 1.35, -.15]),
  nerve("Proprioception", "Sensory pathways", "Signals from muscles, tendons, joints, and skin about body position and movement.", "Supports posture, balance, and coordinated movement, often without conscious attention.", [0, 1.2, .18]),
];

const SectionList = styled.div`display: grid; gap: 12px;`;
const Group = styled.section`display: grid; gap: 6px;`;
const GroupTitle = styled.h3`margin: 10px 2px 2px; font-size: 11px; letter-spacing: .06em; color: ${(p) => p.theme.textSecondary}; text-transform: uppercase;`;
const Card = styled.button<{ $selected: boolean }>`
  display: grid; gap: 5px; text-align: left; width: 100%; padding: 10px 12px;
  border-radius: 8px; border: 1px solid ${(p) => p.$selected ? p.theme.primary : p.theme.border};
  background: ${(p) => p.$selected ? p.theme.primaryAnchor : p.theme.surface}; color: ${(p) => p.theme.textPrimary}; cursor: pointer;
  &:hover { background: ${(p) => p.theme.surfaceHover}; border-color: ${(p) => p.theme.primary}; }
`;
const CardName = styled.strong`font-size: 12px;`;
const CardText = styled.span`font-size: 11px; line-height: 1.45; color: ${(p) => p.theme.textSecondary};`;
const Empty = styled.div`padding: 12px; color: ${(p) => p.theme.textSecondary}; font-size: 12px;`;

function toModelArea(card: AnatomyCardData): Area {
  if (card.model === "human") {
    const target: [number, number, number] = [card.offset[0], 1.7 + card.offset[1] * .5, card.offset[2]];
    return { name: card.name, position: [target[0], target[1] + .12, target[2] + .6], target, meshName: "o_ADBody" };
  }
  const center: [number, number, number] = [
    MODEL_ROOT_POSITION[0] + BRAIN_POSITION[0] + BRAIN_GLB_NODE_TRANSLATION[0] * BRAIN_SCALE[0],
    MODEL_ROOT_POSITION[1] + BRAIN_POSITION[1] + BRAIN_GLB_NODE_TRANSLATION[1] * BRAIN_SCALE[1],
    MODEL_ROOT_POSITION[2] + BRAIN_POSITION[2] + BRAIN_GLB_NODE_TRANSLATION[2] * BRAIN_SCALE[2],
  ];
  const target: [number, number, number] = [center[0] + card.offset[0] * BRAIN_SCALE[0], center[1] + card.offset[1] * BRAIN_SCALE[1], center[2] + card.offset[2] * BRAIN_SCALE[2]];
  return { name: card.name, position: [target[0], target[1], target[2] + .45], target, meshName: "brain" };
}

export function toBrainViewerPoint(target: [number, number, number]): [number, number, number] {
  const center: [number, number, number] = [
    MODEL_ROOT_POSITION[0] + BRAIN_POSITION[0] + BRAIN_GLB_NODE_TRANSLATION[0] * BRAIN_SCALE[0],
    MODEL_ROOT_POSITION[1] + BRAIN_POSITION[1] + BRAIN_GLB_NODE_TRANSLATION[1] * BRAIN_SCALE[1],
    MODEL_ROOT_POSITION[2] + BRAIN_POSITION[2] + BRAIN_GLB_NODE_TRANSLATION[2] * BRAIN_SCALE[2],
  ];
  const local = target.map((value, index) => BRAIN_GLB_NODE_TRANSLATION[index] + (value - center[index]) / BRAIN_SCALE[index]);
  return [0.1 + local[0] * .34, -.6 + local[1] * .34, local[2] * .34];
}

export const AnatomyCardsSection: React.FC<{ kind: "brain" | "nervous"; searchTerm: string }> = ({ kind, searchTerm }) => {
  const { selectedArea, setSelectedArea, setModelVariant, controlsRef, modelVariant } = useModel3D();
  const source = kind === "brain" ? BRAIN_ANATOMY_CARDS : NERVOUS_SYSTEM_CARDS;
  const aliases = (card: AnatomyCardData) => {
    const name = card.name.toLowerCase();
    if (name.includes("auditory") || name.includes("hearing") || name.includes("vestibulocochlear") || name.includes("brodmann area 41") || name.includes("brodmann area 42")) return "audio sound hearing listening ear";
    if (name.includes("laryngeal") || name.includes("vocal")) return "larynx voice speech phonation vocal folds sound";
    return "";
  };
  const filtered = source.filter((card) => `${card.name} ${card.group} ${card.description} ${card.function} ${aliases(card)}`.toLowerCase().includes(searchTerm.trim().toLowerCase()));
  const groups = [...new Set(filtered.map((card) => card.group))];

  useEffect(() => {
    if (!selectedArea || selectedArea.meshName === "brain" || !controlsRef.current) return;
    gsap.to(controlsRef.current.target, { x: selectedArea.target[0], y: selectedArea.target[1], z: selectedArea.target[2], duration: .7, onUpdate: () => controlsRef.current?.update() });
    gsap.to(controlsRef.current.object.position, { x: selectedArea.position[0], y: selectedArea.position[1], z: selectedArea.position[2], duration: .7, onUpdate: () => controlsRef.current?.update() });
  }, [controlsRef, modelVariant, selectedArea]);

  if (!filtered.length) return <Empty>No {kind === "brain" ? "brain" : "nervous system"} cards match “{searchTerm}”.</Empty>;
  return <SectionList>{groups.map((group) => <Group key={group}><GroupTitle>{group}</GroupTitle>{filtered.filter((card) => card.group === group).map((card) => {
    const area = toModelArea(card);
    const isSelected = selectedArea?.name === card.name;
    return <Card key={card.name} $selected={isSelected} aria-pressed={isSelected} onClick={() => { setSelectedArea(area); setModelVariant(card.model); }}><CardName>{card.name}</CardName><CardText>{card.description}</CardText><CardText><b>Function:</b> {card.function}</CardText></Card>;
  })}</Group>)}</SectionList>;
};
