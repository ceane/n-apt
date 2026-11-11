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
  tags: string[];
  relatedAreas?: { name: string; relation: string }[];
};

const brain = (name: string, group: string, description: string, fn: string, offset: [number, number, number], tags: string[] = []): AnatomyCardData => ({ name, group, description, function: fn, model: "brain", offset, tags });
const nerve = (name: string, group: string, description: string, fn: string, offset: [number, number, number] = [0, 0, 0], tags: string[] = []): AnatomyCardData => ({ name, group, description, function: fn, model: "human", offset, tags });
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
  brain("Emotion and affective networks", "Functional networks", "Emotion is produced by interacting brain networks, body signals, learning, and context; it is not located in one single structure.", "Different networks contribute to recognizing significance, experiencing bodily feelings, regulating responses, and interpreting social context. This marker is a general focus point, not an emotion center.", [0, -.01, .02], ["emotion", "emotional processing", "feelings", "mood", "happiness", "happy", "joy", "sadness", "sad", "anger", "angry", "irritability", "fear", "disgust", "surprise", "affect"]),
  brain("Ventral tegmental area", "Deep brain structures", "Dopamine-producing cell groups in the midbrain, with projections to limbic and frontal circuits.", "Participates in motivation, reinforcement learning, and other functions through diverse cell types and projection pathways.", [0, -.105, .025], ["VTA", "dopamine pathway", "motivation", "reinforcement learning", "reward learning"]),
  brain("Raphe nuclei", "Cerebellum and brainstem", "A group of midline brainstem nuclei containing most of the brain's serotonin-producing neurons.", "Sends widespread serotonin projections that modulate sleep-wake activity, mood, appetite, pain, and other functions.", [0, -.16, .025], ["serotonin source", "5-HT", "5-hydroxytryptamine", "raphe system"]),
  brain("Locus coeruleus", "Cerebellum and brainstem", "Small nucleus in the pons and a major source of norepinephrine projections in the brain.", "Modulates arousal, vigilance, attention, and responses to changing demands through widespread projections.", [0, -.16, .045], ["norepinephrine source", "noradrenaline", "alertness", "arousal"]),
  brain("Nucleus accumbens", "Deep brain structures", "Ventral striatal region connected with dopamine, limbic, and frontal circuits.", "Participates in motivation, learning, and translating valued outcomes into actions; it is part of a broader network.", [.06, -.06, .015], ["ventral striatum", "motivation", "reward learning", "reinforcement", "approach behavior"]),
  brain("Dopamine", "Brain chemistry", "A neurotransmitter and neuromodulator made by neurons in several brain systems. This molecule is not itself a brain region; the marker points to representative source and target circuits.", "Modulates movement, action selection, motivation, and learning from outcomes. Dopamine is not simply a pleasure or happiness chemical.", [.02, -.12, .03], ["DA", "dopaminergic", "substantia nigra pathway", "nigrostriatal", "mesolimbic", "mesocortical", "movement", "motivation", "reinforcement learning", "reward prediction"]),
  brain("Serotonin", "Brain chemistry", "A neurotransmitter and neuromodulator also called 5-hydroxytryptamine (5-HT). Most brain serotonin-producing cell bodies are in raphe nuclei; serotonin also has important functions elsewhere in the body.", "Widespread serotonin systems modulate mood, sleep, appetite, memory, pain, and other functions. It is not a simple measure of happiness.", [0, -.16, .025], ["5-HT", "5-hydroxytryptamine", "serotonergic", "mood", "sleep", "appetite", "pain modulation", "raphe nuclei"]),
  brain("Norepinephrine", "Brain chemistry", "A neurotransmitter and neuromodulator also called noradrenaline; many brain projections arise from the locus coeruleus.", "Helps tune alertness, attention, arousal, and responses to changing demands. It also acts in the peripheral nervous system.", [0, -.16, .045], ["noradrenaline", "noradrenergic", "alertness", "arousal", "attention", "locus coeruleus"]),
  brain("Acetylcholine", "Brain chemistry", "A neurotransmitter used by circuits in the brain and by motor neurons at skeletal-muscle junctions.", "Supports attention, learning, and other brain functions; at the neuromuscular junction it triggers skeletal-muscle contraction.", [0, -.05, .02], ["ACh", "cholinergic", "neuromuscular junction", "muscle contraction", "attention", "learning"]),
  brain("Glutamate", "Brain chemistry", "The main fast excitatory neurotransmitter at many synapses in the central nervous system.", "Carries excitatory signals and contributes to synaptic plasticity and learning; its effects depend on receptor type and circuit.", [0, .08, .02], ["glutamatergic", "excitatory neurotransmitter", "synaptic plasticity", "learning", "NMDA", "AMPA"]),
  brain("GABA", "Brain chemistry", "Gamma-aminobutyric acid, the main fast inhibitory neurotransmitter in much of the adult brain.", "Reduces or shapes activity in many circuits and helps coordinate timing; its effect depends on cell type, receptor, and developmental context.", [0, .02, .03], ["gamma-aminobutyric acid", "GABAergic", "inhibitory neurotransmitter", "inhibition", "circuit balance"]),
  brain("Endogenous opioids", "Brain chemistry", "The brain and body make opioid peptides, including endorphins and enkephalins; they act at opioid receptors.", "Modulate pain, stress responses, and reward-related processes across multiple circuits. They are not a single happiness switch.", [0, -.08, .04], ["endorphins", "enkephalins", "natural opioids", "pain modulation", "opioid receptors", "stress response"]),
  brain("Oxytocin", "Brain chemistry", "A peptide made by hypothalamic neurons and released in the brain and into the bloodstream.", "Has hormone and neuromodulator roles in functions such as childbirth and lactation; effects on social behavior depend on context and circuit.", [0, -.09, .035], ["social behavior", "hormone", "peptide", "hypothalamus", "bonding research"]),
  brain("Endocannabinoids", "Brain chemistry", "Lipid signaling molecules made on demand in many cells, including neurons.", "Can act retrogradely across synapses to tune neurotransmitter release; involved in several circuits and body functions.", [0, -.025, .01], ["anandamide", "2-AG", "CB1", "CB2", "retrograde signaling", "synaptic modulation"]),
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
  nerve("Neuromuscular junction", "Muscle activation", "The synapse where a motor neuron communicates with a skeletal muscle fiber.", "Motor-neuron acetylcholine activates receptors on the muscle membrane, initiating the electrical signal that leads to contraction.", [.48, -.1, .35], ["NMJ", "motor end plate", "acetylcholine", "ACh", "muscle activation", "muscle contraction", "motor neuron", "skeletal muscle"]),
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
  nerve("Frontalis", "Facial expression muscles", "Broad forehead muscle that raises the eyebrows and wrinkles the forehead.", "Helps lift the brows and forehead skin. Facial expressions are produced by coordinated muscles and context; this muscle alone does not identify a feeling.", [0, .52, .43], ["forehead", "raise eyebrows", "eyebrow raise", "brow lift", "wrinkle forehead", "facial expression"]),
  nerve("Corrugator supercilii", "Facial expression muscles", "Small muscle near the inner eyebrow that draws the brows inward and downward.", "Contributes to brow furrowing during concentration and some frowning expressions; the movement does not prove anger or sadness.", [0, .42, .46], ["furrow brow", "frown", "draw eyebrows together", "glabellar lines", "facial expression"]),
  nerve("Orbicularis oculi", "Facial expression muscles", "Ring-shaped muscle around each eye.", "Closes the eyelids for blinking, tight squinting, and eye protection. Its eye-corner contraction is one component of some smiles.", [0, .38, .48], ["blink", "blinking", "close eyes", "squint", "wink", "eye closure", "Duchenne smile"]),
  nerve("Zygomaticus major", "Facial expression muscles", "Paired cheek muscles running from the cheekbone to the corners of the mouth.", "Pulls mouth corners upward and outward, contributing to many smiles. A smile can be voluntary or social and does not by itself establish happiness.", [0, .28, .52], ["smile", "smiling", "grin", "raise mouth corners", "cheek lift", "facial expression"]),
  nerve("Zygomaticus minor", "Facial expression muscles", "Cheek muscle that helps elevate the upper lip.", "Assists upper-lip elevation and cheek movement during some smiles and speech expressions.", [0, .31, .52], ["smile", "smiling", "raise upper lip", "cheek lift", "facial expression"]),
  nerve("Risorius", "Facial expression muscles", "Variable thin muscle that draws the mouth corner laterally.", "Can widen the mouth during some expressions and speech; it is not present or equally developed in everyone.", [0, .27, .51], ["smile", "smiling", "widen mouth", "pull mouth sideways", "facial expression", "nervous smile"]),
  nerve("Orbicularis oris", "Facial expression muscles", "Circular muscle complex around the mouth.", "Closes and shapes the lips for puckering, blowing, kissing, articulation, and keeping food or liquid in the mouth.", [0, .18, .56], ["pucker", "puckering", "kiss", "blow", "lip closure", "whistle", "speech articulation", "mouth movement"]),
  nerve("Buccinator", "Facial expression muscles", "Deep cheek muscle forming part of the cheek wall.", "Compresses the cheek against the teeth to keep food positioned during chewing and assists blowing and whistling.", [0, .2, .48], ["cheek", "chewing", "blowing", "whistling", "food in mouth", "suck", "puff cheeks"]),
  nerve("Levator labii superioris", "Facial expression muscles", "Muscle beside the nose that elevates the upper lip.", "Raises the upper lip and contributes to facial movements used in speech and some expressions.", [0, .25, .54], ["raise upper lip", "upper lip lift", "facial expression", "speech articulation"]),
  nerve("Depressor anguli oris", "Facial expression muscles", "Muscle running from the lower jaw toward each mouth corner.", "Draws the mouth corners downward and contributes to some frowns; that movement alone does not establish sadness.", [0, .12, .53], ["frown", "lower mouth corners", "downturned mouth", "facial expression"]),
  nerve("Depressor labii inferioris", "Facial expression muscles", "Muscle below the lower lip that draws it downward and outward.", "Helps move the lower lip during speech and facial expression.", [0, .1, .55], ["lower lip", "lip movement", "frown", "facial expression"]),
  nerve("Mentalis", "Facial expression muscles", "Paired chin muscles that raise and protrude the lower lip.", "Moves the lower lip and wrinkles the chin during pouting and other expressions.", [0, .06, .56], ["pout", "pouting", "protrude lower lip", "chin wrinkle", "facial expression"]),
  nerve("Masseter", "Facial and jaw muscles", "Powerful muscle over the side of the jaw, from the cheekbone to the mandible.", "Elevates the jaw to bite and chew; it also participates in clenching. It is not an emotion marker.", [0, .04, .43], ["chew", "chewing", "bite", "clench jaw", "jaw closing", "mastication", "grinding teeth"]),
  nerve("Biceps brachii", "Muscles and movement", "Front of upper arm, crossing the shoulder and elbow.", "Bends the elbow and turns the palm upward. It contributes to a curl or lifting a light object with the elbow bent; other muscles share the work.", [.48, -.1, .35], ["curl", "curling", "bicep curl", "elbow flexion", "bend elbow", "lift", "lifting", "supination", "turn palm up", "bring cup to mouth"]),
  nerve("Triceps brachii", "Muscles and movement", "Back of upper arm, with three heads spanning the shoulder or elbow.", "Straightens the elbow and assists some shoulder movements, such as pushing or extending the arm.", [.49, -.1, -.25], ["elbow extension", "straighten elbow", "push", "pushing", "press", "throw", "arm extension"]),
  nerve("Deltoid", "Muscles and movement", "Large shoulder muscle with front, middle, and rear portions.", "Raises the arm away from the body and assists forward or backward arm movement depending on the portion recruited.", [.24, -.1, .25], ["raise arm", "lifting arm", "lift overhead", "shoulder abduction", "reach", "reaching", "arm raise"]),
  nerve("Forearm flexor group", "Muscles and movement", "Forearm muscles on the palm side that move the wrist and fingers.", "Bends the wrist and fingers and helps close the hand for gripping, grasping, holding, and curling the fingers.", [.68, -.25, .18], ["grip", "gripping", "grab", "grabbing", "grasp", "grasping", "hold", "holding", "finger flexion", "wrist flexion", "make a fist"]),
  nerve("Forearm extensor group", "Muscles and movement", "Forearm muscles on the back-of-hand side that extend the wrist and fingers.", "Straightens the wrist and fingers and helps release or open the hand after grasping.", [.68, -.25, -.15], ["open hand", "release grip", "let go", "finger extension", "wrist extension", "extend fingers"]),
  nerve("Thenar muscles", "Muscles and movement", "Muscle group at the base of the thumb.", "Positions and moves the thumb, especially opposition used in pinching, picking up small objects, and tool use.", [.8, -.18, .42], ["thumb movement", "thumb opposition", "pinch", "pinching", "precision grip", "pick up", "manipulation"]),
  nerve("Intrinsic hand muscles", "Muscles and movement", "Small muscles within the hand, including interossei and lumbricals.", "Fine-tune finger spacing, bending, and straightening for coordinated grasp, release, typing, and delicate manipulation.", [.8, -.18, .4], ["grabbing", "grasping", "finger control", "fine motor", "typing", "tactile exploration", "hand dexterity", "precision movement"]),
  nerve("Gluteus maximus", "Muscles and movement", "Large muscle forming much of the buttock.", "Extends and rotates the hip, especially when standing from a chair, climbing stairs, or rising from a squat.", [0, -1.15, -.3], ["stand up", "standing", "climb stairs", "hip extension", "squat", "rise", "walking uphill"]),
  nerve("Quadriceps group", "Muscles and movement", "Four muscles across the front of the thigh.", "Straightens the knee for standing, walking, climbing, kicking, and rising from a chair.", [0, -1.5, .25], ["knee extension", "straighten knee", "stand", "walking", "climbing stairs", "kick", "squat", "rise from chair"]),
  nerve("Hamstring group", "Muscles and movement", "Muscles along the back of the thigh.", "Bends the knee and helps extend the hip during walking, running, and other leg movements.", [0, -1.5, -.25], ["bend knee", "knee flexion", "hip extension", "walking", "running", "sprinting"]),
  nerve("Gastrocnemius and soleus", "Muscles and movement", "Calf muscles that join through the Achilles tendon to the heel.", "Point the foot downward and help push the body forward during walking, running, and jumping.", [0, -2.6, -.1], ["calf raise", "point toes", "plantar flexion", "push off", "walk", "walking", "run", "running", "jump"]),
  nerve("Tibialis anterior", "Muscles and movement", "Muscle along the front of the lower leg.", "Lifts the front of the foot and helps turn it inward, clearing the toes during a step.", [.1, -2.6, .15], ["dorsiflexion", "lift toes", "foot lift", "toe clearance", "walk", "walking", "step"]),
  nerve("Diaphragm", "Muscles and movement", "Dome-shaped muscle separating the chest and abdominal cavities.", "Contracts during inhalation and works with other respiratory muscles; it also contributes to coughing, speaking, and pressure control.", [0, -.3, .4], ["breathe", "breathing", "inhalation", "inhale", "respiration", "cough", "speech breath"]),
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
const CardItem = styled.div`display: grid; gap: 4px;`;
const RelatedSection = styled.div`display: grid; gap: 3px; padding: 2px 12px 5px;`;
const RelatedHeading = styled.strong`font-size: 9px; line-height: 1.3; color: ${(p) => p.theme.textMuted}; text-transform: uppercase; letter-spacing: .04em;`;
const RelatedLink = styled.button`
  display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: baseline; border: 0; padding: 2px 0;
  background: transparent; color: ${(p) => p.theme.primary}; text-align: left; font: inherit; cursor: pointer;
  &:hover { text-decoration: underline; }
`;
const RelatedName = styled.strong`font-size: 10px;`;
const RelatedReason = styled.span`font-size: 10px; line-height: 1.35; color: ${(p) => p.theme.textSecondary};`;
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

const SEMANTIC_TAGS_BY_CARD: Record<string, string[]> = {
  "Primary motor cortex": ["movement", "voluntary movement", "lifting", "reaching", "grabbing", "hand movement", "motor control", "motor map"],
  "Premotor cortex": ["movement planning", "reach", "grasp", "lifting", "movement preparation"],
  "Supplementary motor area": ["movement sequence", "two-hand coordination", "motor planning", "movement initiation"],
  "Primary somatosensory cortex": ["touch", "tactile", "texture", "pressure", "finger sensation", "skin sensation", "body map"],
  "Somatosensory association cortex": ["touch recognition", "tactile recognition", "stereognosis", "object by touch", "texture", "hand sensation"],
  "Posterior parietal cortex": ["reach", "grasp", "hand-eye coordination", "spatial attention", "body schema"],
  "Dorsolateral prefrontal cortex": ["emotion regulation", "emotional regulation", "reappraisal", "self-control", "anger management", "attention control"],
  "Ventromedial prefrontal cortex": ["emotion regulation", "emotional regulation", "feelings", "social emotion", "value", "decision making", "happiness", "happy", "sadness", "sad", "anger", "angry", "fear", "mood"],
  "Orbitofrontal cortex": ["emotion", "reward", "social behavior", "value", "decision making", "emotional learning", "happiness", "happy", "anger", "angry", "sadness", "sad", "disappointment"],
  "Insula": ["emotion", "feelings", "bodily feelings", "interoception", "disgust", "pain", "emotional awareness", "gut feeling", "happiness", "happy", "sadness", "sad", "anger", "angry", "anxiety", "fear"],
  "Cingulate cortex": ["emotion", "feelings", "motivation", "pain", "conflict monitoring", "effort", "emotional salience", "emotion regulation", "happiness", "happy", "sadness", "sad", "anger", "angry", "frustration", "distress"],
  Amygdala: ["emotion", "feelings", "emotional learning", "salience", "threat learning", "fear learning", "social emotion", "mood", "happiness", "happy", "sadness", "sad", "anger", "angry", "fear", "anxiety", "stress"],
  Hypothalamus: ["emotion", "autonomic response", "stress response", "fight or flight", "body response", "hunger", "thirst", "temperature", "anger", "angry", "fear", "sadness", "sad", "happiness", "happy", "stress"],
  Cerebellum: ["movement coordination", "timing", "balance", "motor learning", "fine movement", "movement accuracy"],
  "Vocal Cords": ["voice", "phonation", "talking", "singing", "speech sounds", "larynx"],
};

const RELATED_AREAS_BY_CARD: Record<string, { name: string; relation: string }[]> = {
  "Emotion and affective networks": [
    { name: "Amygdala", relation: "salience and emotional learning" },
    { name: "Insula", relation: "body-state and feeling integration" },
    { name: "Cingulate cortex", relation: "motivation, affect, and response monitoring" },
    { name: "Ventromedial prefrontal cortex", relation: "context and emotion regulation" },
    { name: "Serotonin", relation: "modulatory chemistry across multiple circuits" },
    { name: "Dopamine", relation: "motivation and learning signals across multiple circuits" },
    { name: "Zygomaticus major", relation: "smile movement; expression alone does not reveal a person's emotion" },
    { name: "Corrugator supercilii", relation: "brow movement; expression alone does not identify a feeling" },
  ],
  "Orbicularis oculi": [
    { name: "Zygomaticus major", relation: "often contracts with it in a Duchenne-type smile" },
    { name: "Amygdala", relation: "emotion and salience network" },
    { name: "Insula", relation: "body-state and feeling integration" },
    { name: "Emotion and affective networks", relation: "emotion depends on interacting networks and context" },
  ],
  "Zygomaticus major": [
    { name: "Orbicularis oculi", relation: "often joins it in a Duchenne-type smile" },
    { name: "Amygdala", relation: "emotion and salience network" },
    { name: "Insula", relation: "body-state and feeling integration" },
    { name: "Ventromedial prefrontal cortex", relation: "context, value, and emotion regulation" },
    { name: "Dopamine", relation: "motivation and learning circuits; indirect connection" },
    { name: "Emotion and affective networks", relation: "a smile can occur in many emotional or social contexts" },
  ],
  "Zygomaticus minor": [
    { name: "Zygomaticus major", relation: "works with nearby cheek and mouth muscles" },
    { name: "Insula", relation: "body-state and feeling integration" },
    { name: "Ventromedial prefrontal cortex", relation: "context and emotion regulation" },
    { name: "Emotion and affective networks", relation: "expression and felt emotion are related but not one-to-one" },
  ],
  Risorius: [
    { name: "Zygomaticus major", relation: "nearby mouth-corner movement" },
    { name: "Amygdala", relation: "emotion and social-salience networks" },
    { name: "Ventromedial prefrontal cortex", relation: "context and social interpretation" },
    { name: "Emotion and affective networks", relation: "expression and felt emotion are related but not one-to-one" },
  ],
  "Corrugator supercilii": [
    { name: "Amygdala", relation: "emotion and salience network" },
    { name: "Cingulate cortex", relation: "emotion, effort, and conflict monitoring" },
    { name: "Dorsolateral prefrontal cortex", relation: "attention and regulation" },
  ],
  "Depressor anguli oris": [
    { name: "Amygdala", relation: "emotion and salience network" },
    { name: "Cingulate cortex", relation: "emotion and motivation networks" },
    { name: "Insula", relation: "body-state and feeling integration" },
  ],
  "Depressor labii inferioris": [{ name: "Depressor anguli oris", relation: "nearby lower-face expression muscle" }, { name: "Insula", relation: "body-state and feeling integration" }],
  Mentalis: [{ name: "Depressor anguli oris", relation: "nearby lower-face expression muscle" }, { name: "Amygdala", relation: "emotion and salience network" }],
  "Biceps brachii": [{ name: "Primary motor cortex", relation: "voluntary movement commands" }, { name: "Cerebellum", relation: "movement coordination and learning" }],
  "Forearm flexor group": [{ name: "Primary motor cortex", relation: "voluntary movement commands" }, { name: "Primary somatosensory cortex", relation: "touch and hand-position feedback" }],
  "Intrinsic hand muscles": [{ name: "Primary motor cortex", relation: "fine voluntary movement" }, { name: "Primary somatosensory cortex", relation: "tactile and position feedback" }, { name: "Posterior parietal cortex", relation: "hand-centered spatial guidance" }],
  "Primary motor cortex": [
    { name: "Biceps brachii", relation: "example elbow-flexor muscle" },
    { name: "Forearm flexor group", relation: "finger and wrist flexion for grasping" },
    { name: "Intrinsic hand muscles", relation: "fine hand and finger movement" },
    { name: "Zygomaticus major", relation: "voluntary facial movement pathway" },
  ],
  "Primary somatosensory cortex": [
    { name: "Intrinsic hand muscles", relation: "movement is guided by tactile and position feedback" },
    { name: "Cutaneous receptors", relation: "skin touch, pressure, temperature, and pain signals" },
  ],
  Amygdala: [{ name: "Emotion and affective networks", relation: "one contributor to a distributed network" }, { name: "Zygomaticus major", relation: "facial expression can accompany emotion but is not a direct readout" }],
  Insula: [{ name: "Emotion and affective networks", relation: "interoception and subjective feeling networks" }, { name: "Orbicularis oculi", relation: "facial movement can accompany but does not prove a feeling" }],
  "Ventromedial prefrontal cortex": [{ name: "Emotion and affective networks", relation: "context and regulation across interacting circuits" }, { name: "Zygomaticus major", relation: "expression is related behavior, not a one-to-one emotion marker" }],
  "Raphe nuclei": [{ name: "Serotonin", relation: "major neurotransmitter system arising from raphe neurons" }],
  "Ventral tegmental area": [{ name: "Dopamine", relation: "source for several dopamine projection systems" }],
  "Substantia nigra": [{ name: "Dopamine", relation: "source for nigrostriatal dopamine pathways" }],
  "Locus coeruleus": [{ name: "Norepinephrine", relation: "major source of widespread norepinephrine projections" }],
  Dopamine: [
    { name: "Ventral tegmental area", relation: "source for several dopamine projections" },
    { name: "Substantia nigra", relation: "source for nigrostriatal movement circuits" },
    { name: "Nucleus accumbens", relation: "motivation and reinforcement-learning circuit" },
    { name: "Caudate nucleus", relation: "striatal action-selection circuit" },
    { name: "Putamen", relation: "striatal motor-learning circuit" },
  ],
  Serotonin: [
    { name: "Raphe nuclei", relation: "major source of brain serotonin neurons" },
    { name: "Hypothalamus", relation: "sleep, appetite, and homeostatic circuits" },
    { name: "Amygdala", relation: "modulation of emotional-learning circuits" },
    { name: "Cingulate cortex", relation: "modulation of attention and affective circuits" },
  ],
  Norepinephrine: [{ name: "Locus coeruleus", relation: "major source of widespread brain projections" }, { name: "Reticular formation", relation: "arousal and wakefulness networks" }],
  Acetylcholine: [{ name: "Neuromuscular junction", relation: "activates skeletal muscle" }, { name: "Primary motor cortex", relation: "movement-control network" }],
  "Neuromuscular junction": [{ name: "Acetylcholine", relation: "motor neurons release this transmitter at the junction" }, { name: "Biceps brachii", relation: "example skeletal muscle target" }, { name: "Primary motor cortex", relation: "part of the voluntary movement pathway" }],
  Glutamate: [{ name: "Hippocampus", relation: "learning and synaptic-plasticity circuits" }, { name: "Primary motor cortex", relation: "excitatory signaling in motor circuits" }],
  GABA: [{ name: "Cerebellum", relation: "inhibitory signaling in coordination circuits" }, { name: "Amygdala", relation: "inhibitory local circuits" }],
  "Endogenous opioids": [{ name: "Amygdala", relation: "emotion, stress, and reward circuits" }, { name: "Cingulate cortex", relation: "pain and affective processing" }, { name: "Hypothalamus", relation: "homeostatic and stress-related circuits" }],
  Oxytocin: [{ name: "Hypothalamus", relation: "major site of production by specialized neurons" }, { name: "Amygdala", relation: "one of several context-sensitive social-emotion circuits" }],
  Endocannabinoids: [{ name: "Hippocampus", relation: "memory and synaptic-modulation circuits" }, { name: "Amygdala", relation: "emotion and stress-related circuits" }],
};

export const AnatomyCardsSection: React.FC<{ kind: "brain" | "nervous"; searchTerm: string }> = ({ kind, searchTerm }) => {
  const { selectedArea, setSelectedArea, setModelVariant, controlsRef, modelVariant } = useModel3D();
  const allCards = [...BRAIN_ANATOMY_CARDS, ...NERVOUS_SYSTEM_CARDS];
  const source = (kind === "brain" ? BRAIN_ANATOMY_CARDS : NERVOUS_SYSTEM_CARDS).map((card) => {
    const semanticTags = SEMANTIC_TAGS_BY_CARD[card.name];
    return {
      ...card,
      tags: [...card.tags, ...(semanticTags ?? [])],
      relatedAreas: [...(card.relatedAreas ?? []), ...(RELATED_AREAS_BY_CARD[card.name] ?? [])],
    };
  });
  const aliases = (card: AnatomyCardData) => {
    const name = card.name.toLowerCase();
    if (name.includes("auditory") || name.includes("hearing") || name.includes("vestibulocochlear") || name.includes("brodmann area 41") || name.includes("brodmann area 42")) return "audio sound hearing listening ear";
    if (name.includes("laryngeal") || name.includes("vocal")) return "larynx voice speech phonation vocal folds sound";
    return "";
  };
  const searchableText = (card: AnatomyCardData) => {
    const relatedContext = (card.relatedAreas ?? []).map((related) => {
      const target = allCards.find((candidate) => candidate.name === related.name);
      return `${related.name} ${related.relation} ${target?.description ?? ""} ${target?.function ?? ""} ${target?.tags.join(" ") ?? ""} ${SEMANTIC_TAGS_BY_CARD[related.name]?.join(" ") ?? ""}`;
    }).join(" ");
    return `${card.name} ${card.group} ${card.description} ${card.function} ${card.tags.join(" ")} ${aliases(card)} ${relatedContext}`.toLowerCase();
  };
  const filtered = source.filter((card) => searchableText(card).includes(searchTerm.trim().toLowerCase()));
  const groups = [...new Set(filtered.map((card) => card.group))];

  const selectRelatedArea = (name: string) => {
    const linkedCard = allCards.find((card) => card.name === name);
    if (linkedCard) {
      setSelectedArea(toModelArea(linkedCard));
      setModelVariant(linkedCard.model);
      return;
    }
    if (name === "Face") {
      setModelVariant("human");
      return;
    }
  };

  useEffect(() => {
    if (!selectedArea || selectedArea.meshName === "brain" || !controlsRef.current) return;
    gsap.to(controlsRef.current.target, { x: selectedArea.target[0], y: selectedArea.target[1], z: selectedArea.target[2], duration: .7, onUpdate: () => controlsRef.current?.update() });
    gsap.to(controlsRef.current.object.position, { x: selectedArea.position[0], y: selectedArea.position[1], z: selectedArea.position[2], duration: .7, onUpdate: () => controlsRef.current?.update() });
  }, [controlsRef, modelVariant, selectedArea]);

  if (!filtered.length) return <Empty>No {kind === "brain" ? "brain" : "nervous system"} cards match “{searchTerm}”.</Empty>;
  return <SectionList>{groups.map((group) => <Group key={group}><GroupTitle>{group}</GroupTitle>{filtered.filter((card) => card.group === group).map((card) => {
    const area = toModelArea(card);
    const isSelected = selectedArea?.name === card.name;
    return <CardItem key={card.name}><Card $selected={isSelected} aria-pressed={isSelected} onClick={() => { setSelectedArea(area); setModelVariant(card.model); }}><CardName>{card.name}</CardName><CardText>{card.description}</CardText><CardText><b>Function:</b> {card.function}</CardText></Card>{card.relatedAreas?.length ? <RelatedSection><RelatedHeading>Related areas</RelatedHeading>{card.relatedAreas.map((related) => <RelatedLink key={`${card.name}-${related.name}`} type="button" onClick={() => selectRelatedArea(related.name)} aria-label={`Focus ${related.name}, related by ${related.relation}`}><RelatedName>{related.name}</RelatedName><RelatedReason>{related.relation}</RelatedReason></RelatedLink>)}</RelatedSection> : null}</CardItem>;
  })}</Group>)}</SectionList>;
};
