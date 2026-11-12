import React, { useEffect } from "react";
import styled from "styled-components";
import { gsap } from "gsap";
import { BRAIN_POSITION, BRAIN_SCALE, MODEL_ROOT_POSITION } from "@n-apt/consts";
import { useModel3D, type Area } from "@n-apt/three-d/public/useModel3D";
import { PHYSIOLOGY_AREAS } from "@n-apt/learn/sidebar/BodyAreasSection";

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
  nerve("Corticospinal tract", "Spinal cord", "A major descending motor pathway from cerebral cortex through the brainstem and spinal cord.", "Contributes to voluntary movement, especially precise control of distal limbs. Damage can cause weakness or loss of movement, depending on location and extent.", [0, 1.35, -.1], ["pyramidal tract", "upper motor neuron pathway", "voluntary motor control", "movement impairment"]),
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
  nerve("Musculocutaneous nerve", "Major peripheral nerves", "Brachial plexus branch passing through the anterior upper arm and continuing as the lateral antebrachial cutaneous nerve.", "Supplies the biceps, brachialis, and coracobrachialis and carries sensation from the lateral forearm.", [.25, 1.3, .2], ["elbow flexion", "biceps", "brachialis", "front of arm", "lateral forearm sensation"]),
  nerve("Median nerve", "Major peripheral nerves", "Brachial plexus nerve passing through the carpal tunnel into the hand.", "Supplies several forearm flexors and thumb-side hand muscles and sensation to parts of the palm and fingers.", [.2, 1.08, .15]),
  nerve("Ulnar nerve", "Major peripheral nerves", "Brachial plexus nerve passing behind the medial elbow to the hand.", "Supplies many small hand muscles and sensation to the little-finger side of the hand.", [.27, 1.0, .14]),
  nerve("Femoral nerve", "Major peripheral nerves", "Major lumbar plexus branch passing beneath the inguinal ligament.", "Supplies hip flexors and knee extensors and sensation to the anterior thigh and medial lower leg.", [.13, .82, .12]),
  nerve("Obturator nerve", "Major peripheral nerves", "Lumbar plexus branch passing through the obturator canal.", "Supplies most thigh adductors and sensation to a small area of medial thigh.", [.09, .78, .12]),
  nerve("Sciatic nerve", "Major peripheral nerves", "Largest peripheral nerve, formed by L4–S3 roots and traveling through the posterior thigh.", "Carries fibers for most muscles and skin below the knee through its tibial and common fibular branches.", [0, .72, -.2]),
  nerve("Superior gluteal nerve", "Major peripheral nerves", "Nerve arising mainly from L4–S1 roots and passing through the greater sciatic foramen above piriformis.", "Supplies gluteus medius, gluteus minimus, and tensor fasciae latae for hip abduction and pelvic stabilization.", [.12, .78, -.16], ["gluteal nerve", "buttock muscle nerve", "hip abduction", "pelvic stability", "gluteus medius", "gluteus minimus"]),
  nerve("Inferior gluteal nerve", "Major peripheral nerves", "Nerve arising mainly from L5–S2 roots and passing below piriformis into the deep buttock.", "Supplies gluteus maximus, supporting powerful hip extension for standing, climbing, running, and rising from a squat.", [0, .75, -.2], ["gluteal nerve", "buttock muscle nerve", "hip extension", "gluteus maximus", "standing", "climbing", "running"]),
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
  nerve("Gluteus maximus", "Gluteal and deep hip muscles", "Large superficial muscle forming most of the buttock.", "Powerfully extends and rotates the hip, especially when standing from a chair, climbing stairs, running, or rising from a squat.", [0, -1.15, -.3], ["ass", "ass muscles", "butt", "buttock", "buttocks", "glutes", "stand up", "standing", "climb stairs", "hip extension", "squat", "rise", "walking uphill"]),
  nerve("Quadriceps group", "Muscles and movement", "Four muscles across the front of the thigh.", "Straightens the knee for standing, walking, climbing, kicking, and rising from a chair.", [0, -1.5, .25], ["knee extension", "straighten knee", "stand", "walking", "climbing stairs", "kick", "squat", "rise from chair"]),
  nerve("Rectus femoris", "Hip and thigh muscles", "Superficial quadriceps muscle that crosses both the hip and knee.", "Straightens the knee and assists hip flexion, such as lifting the thigh or kicking forward.", [0, -1.42, .25], ["kick", "straighten knee", "hip flexion", "lift thigh", "stairs", "quadriceps"]),
  nerve("Vastus lateralis", "Hip and thigh muscles", "Large quadriceps muscle on the outer thigh.", "Extends the knee and helps stabilize the patella during standing, walking, and rising.", [.08, -1.52, .23], ["straighten knee", "knee extension", "stand", "walk", "rise from chair", "quadriceps"]),
  nerve("Vastus medialis", "Hip and thigh muscles", "Quadriceps muscle on the inner front of the thigh, including fibers near the knee.", "Extends the knee and contributes to patellar tracking and knee stability during gait.", [-.06, -1.5, .22], ["straighten knee", "knee extension", "patella", "knee stability", "walking", "quadriceps"]),
  nerve("Vastus intermedius", "Hip and thigh muscles", "Deep quadriceps muscle between vastus lateralis and vastus medialis, beneath rectus femoris.", "Extends the knee as part of the quadriceps group.", [0, -1.53, .2], ["straighten knee", "knee extension", "stand", "walking", "quadriceps"]),
  nerve("Hamstring group", "Muscles and movement", "Muscles along the back of the thigh.", "Bends the knee and helps extend the hip during walking, running, and other leg movements.", [0, -1.5, -.25], ["bend knee", "knee flexion", "hip extension", "walking", "running", "sprinting"]),
  nerve("Biceps femoris", "Hip and thigh muscles", "Lateral hamstring muscle with a long head crossing the hip and knee and a short head crossing the knee.", "Flexes the knee and rotates the lower leg outward; its long head also extends the hip.", [.08, -1.58, -.23], ["bend knee", "knee flexion", "hip extension", "rotate lower leg outward", "running", "hamstring"]),
  nerve("Semitendinosus", "Hip and thigh muscles", "Medial hamstring muscle with a long tendon reaching the inner upper tibia.", "Extends the hip, flexes the knee, and helps rotate the bent lower leg inward.", [-.04, -1.58, -.25], ["bend knee", "knee flexion", "hip extension", "rotate lower leg inward", "running", "hamstring"]),
  nerve("Semimembranosus", "Hip and thigh muscles", "Broad, deep medial hamstring muscle attaching near the inner back of the knee.", "Extends the hip, flexes the knee, and helps rotate the bent lower leg inward.", [-.08, -1.56, -.24], ["bend knee", "knee flexion", "hip extension", "rotate lower leg inward", "running", "hamstring"]),
  nerve("Adductor magnus", "Hip and thigh muscles", "Large deep muscle spanning much of the inner thigh, with adductor and hamstring portions.", "Brings the thigh toward the midline; portions also assist hip flexion or extension depending on position.", [.1, -1.4, .1], ["squeeze thighs", "adduction", "bring leg inward", "hip extension", "stabilize pelvis"]),
  nerve("Gracilis", "Hip and thigh muscles", "Long slender muscle running down the inner thigh to the medial tibia.", "Adducts the hip and assists knee flexion and inward rotation of the bent lower leg.", [.05, -1.45, .22], ["adduct thigh", "bring legs together", "bend knee", "inner thigh", "cross legs"]),
  nerve("Gastrocnemius and soleus", "Muscles and movement", "Calf muscles that join through the Achilles tendon to the heel.", "Point the foot downward and help push the body forward during walking, running, and jumping.", [0, -2.6, -.1], ["calf raise", "point toes", "plantar flexion", "push off", "walk", "walking", "run", "running", "jump"]),
  nerve("Gastrocnemius", "Lower leg and foot muscles", "Two-headed superficial calf muscle crossing behind the knee and joining the Achilles tendon.", "Points the foot downward and also assists knee flexion, especially during push-off, running, and jumping.", [0, -2.58, -.08], ["calf raise", "point toes", "plantar flexion", "bend knee", "push off", "run", "jump"]),
  nerve("Tibialis anterior", "Muscles and movement", "Muscle along the front of the lower leg.", "Lifts the front of the foot and helps turn it inward, clearing the toes during a step.", [.1, -2.6, .15], ["dorsiflexion", "lift toes", "foot lift", "toe clearance", "walk", "walking", "step"]),
  nerve("Iliopsoas", "Hip and thigh muscles", "The psoas major and iliacus converge to cross the front of the hip.", "A major hip flexor that lifts the thigh toward the trunk and assists trunk flexion when the legs are fixed.", [0, -.95, .18], ["hip flexion", "lift knee", "march", "climb stairs", "sit up", "bring thigh forward"]),
  nerve("Gluteus medius", "Gluteal and deep hip muscles", "Fan-shaped muscle on the outer pelvis, deep to gluteus maximus.", "Abducts the hip and stabilizes the pelvis during single-leg stance, walking, and stair climbing.", [.18, -1.15, -.05], ["ass", "ass muscles", "butt", "buttock", "buttocks", "glutes", "hip abduction", "pelvic stability", "walking", "single leg stance", "step up", "balance", "side of butt"]),
  nerve("Gluteus minimus", "Gluteal and deep hip muscles", "Deep, smaller muscle beneath gluteus medius on the outer hip.", "Assists hip abduction and medial rotation and helps stabilize the pelvis during gait.", [.16, -1.12, -.03], ["ass", "ass muscles", "butt", "buttock", "buttocks", "glutes", "hip abduction", "medial rotation", "pelvic stability", "walking", "gait", "deep butt muscle"]),
  nerve("Tensor fasciae latae", "Gluteal and deep hip muscles", "Small muscle at the outer front of the hip that blends into the iliotibial tract.", "Flexes, abducts, and internally rotates the hip and helps stabilize the knee through tension in the iliotibial tract.", [.22, -1.1, .18], ["ass muscles", "buttock", "glutes", "outer hip", "side of butt", "hip flexion", "hip abduction", "internal rotation", "stabilize knee", "walking"]),
  nerve("Piriformis", "Gluteal and deep hip muscles", "Deep buttock muscle running from the sacrum through the greater sciatic foramen to the upper femur.", "Externally rotates the extended hip and assists abduction when the hip is flexed; it also helps stabilize the hip joint.", [.03, -1.2, -.2], ["ass muscles", "buttock", "glutes", "deep buttock", "deep butt muscle", "external rotation", "turn thigh outward", "hip stability", "leg rotation"]),
  nerve("Obturator internus", "Gluteal and deep hip muscles", "Deep pelvic muscle whose tendon turns sharply through the lesser sciatic foramen to the femur.", "Externally rotates the hip and stabilizes the femoral head, especially when the hip is flexed.", [.04, -1.22, -.18], ["ass muscles", "buttock", "glutes", "deep buttock", "external rotation", "turn thigh outward", "hip stability"]),
  nerve("Superior gemellus", "Gluteal and deep hip muscles", "Small deep hip muscle above the obturator internus tendon.", "Assists obturator internus in externally rotating and stabilizing the hip.", [.05, -1.18, -.17], ["ass muscles", "buttock", "glutes", "deep buttock", "external rotation", "turn thigh outward", "hip stability"]),
  nerve("Inferior gemellus", "Gluteal and deep hip muscles", "Small deep hip muscle below the obturator internus tendon.", "Assists obturator internus in externally rotating and stabilizing the hip.", [.04, -1.24, -.19], ["ass muscles", "buttock", "glutes", "deep buttock", "external rotation", "turn thigh outward", "hip stability"]),
  nerve("Quadratus femoris", "Gluteal and deep hip muscles", "Short, flat deep buttock muscle running from the ischium to the upper femur.", "Externally rotates the hip and assists adduction while stabilizing the hip joint.", [.04, -1.26, -.18], ["ass muscles", "buttock", "glutes", "deep buttock", "external rotation", "hip adduction", "turn thigh outward", "hip stability"]),
  nerve("Adductor longus", "Hip and thigh muscles", "A superficial muscle on the inner thigh running from the pubis toward the femur.", "Brings the thigh toward the body's midline and assists hip flexion.", [.08, -1.3, .18], ["adduction", "squeeze thighs", "cross legs", "bring leg inward", "hip flexion"]),
  nerve("Sartorius", "Hip and thigh muscles", "Long strap-like muscle that crosses diagonally from the outer hip to the inner knee.", "Assists hip flexion, abduction, and external rotation, and knee flexion; it contributes to the cross-legged sitting position.", [.13, -1.45, .25], ["cross legs", "sit cross-legged", "hip flexion", "knee bend", "leg movement"]),
  nerve("Brachialis", "Arm and forearm muscles", "Deep muscle on the front of the upper arm, attaching the humerus to the ulna.", "A strong elbow flexor that bends the forearm regardless of whether the palm faces up or down.", [.48, -.08, .25], ["bend elbow", "elbow flexion", "curl", "lift", "bring hand toward shoulder"]),
  nerve("Trapezius", "Shoulder and back muscles", "Broad superficial muscle spanning the neck, upper back, and shoulder girdle.", "Its upper, middle, and lower fibers elevate, retract, depress, and rotate the scapula; it also assists neck extension.", [.25, .15, -.25], ["shrug", "shoulder elevation", "pull shoulders back", "scapular rotation", "neck extension", "posture"]),
  nerve("Pectoralis major", "Shoulder and back muscles", "Large fan-shaped chest muscle attaching the clavicle, sternum, and ribs to the upper arm.", "Brings the arm across the chest and assists shoulder flexion and inward rotation, as in pushing, hugging, or pressing.", [.28, -.1, .38], ["push", "push-up", "bench press", "hug", "arm across chest", "shoulder adduction", "internal rotation"]),
  nerve("Latissimus dorsi", "Shoulder and back muscles", "Broad lower-back muscle that attaches to the upper arm near the shoulder.", "Draws the arm down and back and rotates it inward, as in pulling, climbing, rowing, or swimming.", [.34, -.4, -.25], ["pull", "pull-up", "rowing", "climbing", "swimming", "shoulder extension", "arm down and back"]),
  nerve("Supraspinatus", "Rotator cuff muscles", "Rotator cuff muscle passing above the shoulder blade's spine to the upper humerus.", "Assists the beginning of arm abduction and helps stabilize the shoulder joint during movement.", [.3, -.02, .12], ["start raising arm", "shoulder abduction", "rotator cuff", "reach", "shoulder stability"]),
  nerve("Infraspinatus", "Rotator cuff muscles", "Rotator cuff muscle covering much of the back of the shoulder blade.", "Rotates the arm outward and helps stabilize the shoulder joint.", [.32, -.1, -.1], ["external rotation", "turn arm outward", "rotator cuff", "shoulder stability", "throwing"]),
  nerve("Teres minor", "Rotator cuff muscles", "Small rotator cuff muscle along the outer border of the shoulder blade.", "Assists outward rotation of the arm and stabilizes the shoulder joint.", [.34, -.13, -.08], ["external rotation", "turn arm outward", "rotator cuff", "shoulder stability"]),
  nerve("Subscapularis", "Rotator cuff muscles", "Rotator cuff muscle on the front surface of the shoulder blade facing the ribs.", "Rotates the arm inward and helps hold the upper-arm head centered in the shoulder joint.", [.28, -.08, .18], ["internal rotation", "turn arm inward", "rotator cuff", "shoulder stability"]),
  nerve("Brachioradialis", "Arm and forearm muscles", "Prominent muscle along the thumb-side of the forearm, from upper arm to distal radius.", "Flexes the elbow most effectively with the thumb pointing upward, as in a handshake or hammer curl.", [.65, -.22, .28], ["hammer curl", "handshake position", "neutral grip", "bend elbow", "lift cup"]),
  nerve("Pronator teres", "Arm and forearm muscles", "Crosses the front of the proximal forearm from the medial elbow to the radius.", "Turns the forearm so the palm faces down and assists elbow flexion.", [.62, -.18, .2], ["pronation", "turn palm down", "rotate forearm", "use screwdriver", "typing"]),
  nerve("Supinator", "Arm and forearm muscles", "Wraps around the upper radius near the elbow.", "Turns the forearm so the palm faces forward or upward, especially when the elbow is extended.", [.6, -.18, -.15], ["supination", "turn palm up", "rotate forearm", "receive change", "open hand palm up"]),
  nerve("Flexor digitorum superficialis", "Forearm and hand muscles", "Forearm muscle whose tendons pass through the palm to the middle finger bones of digits 2–5.", "Bends the proximal finger joints and assists finger and wrist flexion for gripping and holding.", [.72, -.26, .2], ["bend fingers", "finger flexion", "grip", "grasp", "hold", "curl fingers", "clench fist"]),
  nerve("Flexor digitorum profundus", "Forearm and hand muscles", "Deep forearm muscle with tendons reaching the tips of digits 2–5.", "Bends the fingertips at the distal finger joints, helping make a tight fist and hold small objects.", [.74, -.3, .18], ["bend fingertips", "finger flexion", "distal interphalangeal", "tight fist", "grip", "pinch", "hold"]),
  nerve("Extensor digitorum", "Forearm and hand muscles", "Forearm muscle with tendons that spread across the back of the hand to digits 2–5.", "Extends the fingers, especially at the middle knuckles, and assists wrist extension when opening the hand or releasing a grip.", [.72, -.25, -.15], ["straighten fingers", "finger extension", "open hand", "release", "let go", "wrist extension"]),
  nerve("Extensor indicis", "Forearm and hand muscles", "Small deep forearm muscle whose tendon reaches the index finger.", "Adds independent extension of the index finger for pointing and precise finger positioning.", [.76, -.27, -.18], ["point", "index finger extension", "independent finger movement", "typing", "gesture"]),
  nerve("Flexor pollicis longus", "Forearm and hand muscles", "Deep forearm muscle whose tendon runs to the thumb tip.", "Bends the thumb at its tip joint for pinching, gripping, and manipulating small objects.", [.77, -.28, .24], ["bend thumb", "thumb flexion", "pinch", "grip", "pick up coin", "button"]),
  nerve("Extensor pollicis longus", "Forearm and hand muscles", "Deep forearm tendon that curves around the wrist to the thumb tip.", "Straightens the thumb tip and helps extend the thumb away from the palm.", [.78, -.25, -.2], ["straighten thumb", "thumb extension", "release pinch", "thumb movement"]),
  nerve("Extensor pollicis brevis", "Forearm and hand muscles", "Forearm muscle with a tendon to the base of the thumb's proximal phalanx.", "Extends the thumb at its base and helps move it away from the palm.", [.79, -.24, -.18], ["thumb extension", "move thumb away", "release grip", "thumb movement"]),
  nerve("Abductor pollicis longus", "Forearm and hand muscles", "Forearm muscle whose tendon reaches the base of the thumb near the wrist.", "Moves the thumb away from the palm and assists thumb positioning for grasping.", [.79, -.21, -.15], ["thumb abduction", "move thumb out", "grasp", "thumb positioning"]),
  nerve("Lumbricals of the hand", "Intrinsic hand muscles", "Four small muscles in the palm arising from the deep finger-flexor tendons.", "Flex the large knuckles while helping extend the finger joints, supporting precise positioning such as writing and typing.", [.8, -.16, .4], ["lumbricals", "intrinsic hand", "precision grip", "writing", "typing", "finger positioning", "MCP flexion", "IP extension"]),
  nerve("Dorsal interossei of the hand", "Intrinsic hand muscles", "Four muscles between the metacarpal bones on the back of the hand.", "Spread the fingers away from the middle finger and assist coordinated knuckle flexion and finger-joint extension.", [.8, -.15, -.12], ["spread fingers", "finger abduction", "splay fingers", "typing", "intrinsic hand", "finger coordination"]),
  nerve("Palmar interossei of the hand", "Intrinsic hand muscles", "Three muscles between metacarpal bones on the palm side.", "Draw fingers toward the middle finger and assist coordinated finger-joint positioning.", [.8, -.16, .42], ["bring fingers together", "finger adduction", "close fingers", "grip", "intrinsic hand"]),
  nerve("Hypothenar muscles", "Intrinsic hand muscles", "Muscle group forming the fleshy pad at the base of the little finger.", "Moves and cups the little finger, helping shape the palm for power grip and hand positioning.", [.82, -.14, .4], ["little finger", "pinky movement", "cup hand", "grip", "opposition", "hand shaping"]),
  nerve("Adductor pollicis", "Intrinsic hand muscles", "Deep palm muscle with oblique and transverse parts that crosses toward the thumb.", "Pulls the thumb toward the palm and index finger for key pinch and strong grasp.", [.79, -.15, .4], ["thumb adduction", "key pinch", "hold key", "grip", "bring thumb in"]),
  nerve("Flexor pollicis brevis", "Intrinsic hand muscles", "Thenar muscle at the base of the thumb.", "Bends the thumb at its base and helps position the thumb during pinch and opposition.", [.79, -.14, .43], ["bend thumb", "thumb flexion", "pinch", "opposition", "thenar"]),
  nerve("Abductor pollicis brevis", "Intrinsic hand muscles", "Superficial thenar muscle along the palm side of the thumb.", "Moves the thumb away from the palm, helping position it to grasp or oppose the fingers.", [.8, -.13, .45], ["thumb abduction", "move thumb out", "opposition", "thenar", "grasp"]),
  nerve("Opponens pollicis", "Intrinsic hand muscles", "Deep thenar muscle running along the first metacarpal.", "Rotates and brings the thumb across the palm toward the fingertips for opposition and precision pinch.", [.8, -.15, .44], ["thumb opposition", "touch thumb to fingertip", "pinch", "precision grip", "thenar"]),
  nerve("Temporalis", "Facial and jaw muscles", "Fan-shaped muscle on the side of the skull above the ear, attaching to the mandible.", "Elevates and retracts the jaw during biting and chewing.", [.12, .28, -.1], ["chew", "chewing", "bite", "close jaw", "retract jaw", "clench teeth", "mastication"]),
  nerve("Medial pterygoid", "Facial and jaw muscles", "Deep jaw muscle on the inner side of the mandible.", "Elevates the jaw and assists side-to-side grinding movements during chewing.", [.08, .03, .3], ["chew", "grinding", "jaw closing", "side to side jaw", "mastication"]),
  nerve("Lateral pterygoid", "Facial and jaw muscles", "Deep muscle extending from the skull base to the jaw joint and mandible.", "Protracts and helps open the jaw and guides side-to-side movements used for chewing.", [.08, .03, .34], ["open jaw", "protract jaw", "chewing", "side to side jaw", "jaw movement"]),
  nerve("Levator anguli oris", "Facial expression muscles", "Muscle beside the nose that reaches the corner of the mouth.", "Raises the mouth corner and contributes to expressions and movements used in speech.", [0, .18, .53], ["raise mouth corner", "smile", "facial expression", "speech articulation"]),
  nerve("Nasalis", "Facial expression muscles", "Muscle over the nose with transverse and alar portions.", "Compresses or flares the nostrils and changes the shape of the nasal opening during facial expression and breathing.", [0, .34, .52], ["flare nostrils", "nostril movement", "nose expression", "breathing"]),
  nerve("Procerus", "Facial expression muscles", "Small midline muscle over the bridge of the nose between the eyebrows.", "Pulls the skin between the brows downward and creates transverse wrinkles over the nasal bridge.", [0, .39, .5], ["furrow brow", "wrinkle nose", "glare", "facial expression"]),
  nerve("Platysma", "Facial expression muscles", "Thin sheet-like muscle across the front and sides of the neck, extending into the lower face.", "Tenses neck skin and can draw the lower lip or mouth corner downward during expression.", [0, .1, .4], ["tense neck", "neck skin", "lower lip", "grimace", "facial expression"]),
  nerve("Levator palpebrae superioris", "Eye and eyelid muscles", "Skeletal muscle in the orbit that reaches the upper eyelid.", "Elevates and retracts the upper eyelid to open the eye; it works with smooth superior tarsal muscle tone.", [0, .42, .55], ["open eyes", "raise upper eyelid", "eyelid elevation", "ptosis", "blinking"]),
  nerve("Superior tarsal muscle", "Eye and eyelid muscles", "Smooth muscle within the upper eyelid, extending from the levator muscle to the tarsal plate.", "Adds resting elevation to the upper eyelid under sympathetic control; it is distinct from the skeletal levator palpebrae superioris.", [0, .41, .55], ["eyelid", "upper eyelid", "eyelid tone", "sympathetic", "open eye"]),
  nerve("Superior rectus", "Extraocular muscles", "Extraocular muscle running from the orbital apex to the top of the eyeball.", "Primarily elevates the eye and also contributes to inward rotation and adduction depending on gaze position.", [.06, .39, .52], ["look up", "eye elevation", "eyeball movement", "gaze"]),
  nerve("Inferior rectus", "Extraocular muscles", "Extraocular muscle running to the underside of the eyeball.", "Primarily depresses the eye and also contributes to outward rotation and adduction depending on gaze position.", [.06, .35, .52], ["look down", "eye depression", "eyeball movement", "gaze"]),
  nerve("Medial rectus", "Extraocular muscles", "Extraocular muscle on the nose-facing side of the eyeball.", "Turns the eye inward toward the nose for convergence and horizontal gaze.", [.03, .37, .55], ["look inward", "eye adduction", "convergence", "reading", "near focus"]),
  nerve("Lateral rectus", "Extraocular muscles", "Extraocular muscle on the temple-facing side of the eyeball.", "Turns the eye outward away from the nose for horizontal gaze.", [.09, .37, .55], ["look outward", "eye abduction", "side gaze"]),
  nerve("Superior oblique", "Extraocular muscles", "Extraocular muscle whose tendon passes through the trochlea at the upper inner orbit.", "Intorts the eye and helps depress it, especially when the eye is turned inward.", [.04, .4, .54], ["look down and in", "eye intorsion", "oblique muscle", "gaze stabilization"]),
  nerve("Inferior oblique", "Extraocular muscles", "Extraocular muscle arising from the front of the orbital floor and passing under the eyeball.", "Extorts and elevates the eye, especially when the eye is turned inward.", [.04, .34, .54], ["look up and in", "eye extorsion", "oblique muscle", "gaze stabilization"]),
  nerve("Cricothyroid", "Intrinsic laryngeal muscles", "Laryngeal muscle spanning the cricoid and thyroid cartilages.", "Tilts the thyroid cartilage forward to lengthen and tense the vocal folds, supporting pitch elevation.", [0, .13, .35], ["pitch", "high notes", "tense vocal folds", "phonation", "singing", "voice"]),
  nerve("Posterior cricoarytenoid", "Intrinsic laryngeal muscles", "Paired muscle on the back of the larynx, connecting the cricoid and arytenoid cartilages.", "Abducts the vocal folds to open the glottis for breathing; it is the only muscle that opens the vocal folds.", [0, .12, .3], ["open vocal folds", "breathe", "airway", "glottis", "abduction", "inhalation"]),
  nerve("Lateral cricoarytenoid", "Intrinsic laryngeal muscles", "Paired muscle along the side of the larynx connecting cricoid and arytenoid cartilages.", "Adducts the vocal folds to help close the front portion of the glottis during voice production.", [0, .14, .32], ["close vocal folds", "voice", "phonation", "glottis closure", "adduction"]),
  nerve("Thyroarytenoid and vocalis", "Intrinsic laryngeal muscles", "Muscle pair running between the thyroid cartilage and arytenoid region, alongside the vocal ligament.", "Adjusts vocal-fold length and tension and fine-tunes voice quality and pitch.", [0, .15, .34], ["voice", "phonation", "vocal folds", "pitch", "voice quality", "speech", "singing"]),
  nerve("Interarytenoid muscles", "Intrinsic laryngeal muscles", "Transverse and oblique fibers connecting the arytenoid cartilages at the back of the larynx.", "Draw the arytenoids together to close the back of the glottis during phonation and airway protection.", [0, .13, .31], ["close glottis", "voice", "phonation", "swallowing", "airway protection"]),
  nerve("Suprahyoid muscle group", "Throat and swallowing muscles", "Digastric, mylohyoid, stylohyoid, and geniohyoid muscles above the hyoid bone.", "Elevates the hyoid and floor of the mouth during swallowing and can assist jaw opening when the hyoid is fixed.", [0, .2, .34], ["swallow", "swallowing", "hyoid elevation", "open jaw", "floor of mouth", "speech"]),
  nerve("Infrahyoid muscle group", "Throat and swallowing muscles", "Sternohyoid, omohyoid, sternothyroid, and thyrohyoid muscles below or attaching to the hyoid.", "Positions and stabilizes the hyoid and larynx during swallowing, speech, and related movements.", [0, .08, .32], ["swallow", "swallowing", "lower hyoid", "larynx movement", "speech", "voice"]),
  nerve("Genioglossus", "Tongue muscles", "Large fan-shaped tongue muscle extending from the inner mandible into the tongue.", "Protrudes the tongue and helps depress its central portion; it also helps keep the tongue from falling backward.", [0, .25, .48], ["stick out tongue", "tongue protrusion", "tongue movement", "speech", "swallowing", "airway"]),
  nerve("Hyoglossus", "Tongue muscles", "Flat muscle running from the hyoid bone to the side of the tongue.", "Depresses and retracts the tongue during articulation and swallowing.", [0, .18, .42], ["lower tongue", "retract tongue", "tongue movement", "speech", "swallowing"]),
  nerve("Styloglossus", "Tongue muscles", "Muscle extending from the styloid process toward the side of the tongue.", "Retracts and elevates the tongue, helping shape it during swallowing and speech.", [0, .26, .43], ["retract tongue", "raise tongue", "tongue movement", "speech", "swallowing"]),
  nerve("Palatoglossus", "Tongue and palate muscles", "Muscle forming the anterior faucial arch between the soft palate and side of the tongue.", "Elevates the back of the tongue or lowers the soft palate to narrow the opening between mouth and throat during swallowing.", [0, .28, .4], ["swallow", "swallowing", "raise tongue base", "soft palate", "speech articulation"]),
  nerve("Intrinsic tongue muscles", "Tongue muscles", "Superior and inferior longitudinal, transverse, and vertical muscle fibers contained within the tongue.", "Change tongue shape—shortening, curling, narrowing, broadening, and flattening it—for precise speech sounds and food manipulation.", [0, .28, .49], ["curl tongue", "tongue shape", "tongue control", "speech sounds", "articulation", "chewing", "swallowing", "intrinsic tongue"]),
  nerve("Soleus", "Lower leg and foot muscles", "Broad calf muscle deep to gastrocnemius, attaching to the heel through the Achilles tendon.", "Plantarflexes the ankle and helps maintain upright posture during standing and walking.", [0, -2.65, -.12], ["point toes", "plantar flexion", "standing", "posture", "calf raise", "walking"]),
  nerve("Tibialis posterior", "Lower leg and foot muscles", "Deep posterior lower-leg muscle whose tendon passes behind the inner ankle into the foot.", "Inverts and plantarflexes the foot and supports the medial arch during standing and gait.", [.08, -2.55, -.18], ["turn sole inward", "inversion", "plantar flexion", "arch support", "walking", "balance"]),
  nerve("Fibularis longus", "Lower leg and foot muscles", "Lateral lower-leg muscle whose tendon passes behind the outer ankle and across the sole.", "Everts and plantarflexes the foot and helps support the transverse and lateral arches.", [.15, -2.55, -.12], ["turn sole outward", "eversion", "plantar flexion", "ankle stability", "walking"]),
  nerve("Fibularis brevis", "Lower leg and foot muscles", "Shorter lateral lower-leg muscle with a tendon attaching to the base of the fifth metatarsal.", "Everts the foot and assists plantarflexion, helping stabilize the outer ankle.", [.16, -2.58, -.1], ["eversion", "turn sole outward", "ankle stability", "plantar flexion"]),
  nerve("Extensor digitorum longus", "Lower leg and foot muscles", "Anterior lower-leg muscle with tendons extending to toes 2–5.", "Extends the toes and helps lift the foot at the ankle during the swing phase of walking.", [.12, -2.55, .14], ["straighten toes", "toe extension", "dorsiflexion", "walk", "toe clearance"]),
  nerve("Extensor hallucis longus", "Lower leg and foot muscles", "Anterior lower-leg muscle with a tendon to the big toe.", "Extends the big toe and assists ankle dorsiflexion for toe clearance during walking.", [.1, -2.58, .18], ["lift big toe", "big toe extension", "dorsiflexion", "walking", "step"]),
  nerve("Flexor digitorum longus", "Lower leg and foot muscles", "Deep posterior lower-leg muscle whose tendons reach toes 2–5 on the sole.", "Flexes the lesser toes and assists plantarflexion and support during push-off.", [.1, -2.6, -.16], ["curl toes", "toe flexion", "grip ground", "push off", "balance", "walking"]),
  nerve("Flexor hallucis longus", "Lower leg and foot muscles", "Deep posterior lower-leg muscle with a tendon running to the tip of the big toe.", "Flexes the big toe and contributes to push-off and balance while walking, running, and jumping.", [.08, -2.62, -.18], ["curl big toe", "big toe flexion", "push off", "balance", "walking", "running"]),
  nerve("Intrinsic foot muscles", "Lower leg and foot muscles", "Small muscles located entirely within the foot, arranged in layers on the sole and dorsum.", "Move and stabilize the toes and support the arches during standing, balance, and propulsion; includes muscles such as the lumbricals and interossei.", [0, -2.85, .15], ["toe control", "spread toes", "curl toes", "foot arch", "balance", "walking", "intrinsic foot"]),
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

const SectionList = styled.div`display: grid; gap: 14px;`;
const Group = styled.section`display: grid; gap: 8px;`;
const GroupTitle = styled.h3`margin: 8px 2px 3px; font-size: 11px; letter-spacing: .06em; color: ${(p) => p.theme.textSecondary}; text-transform: uppercase;`;
const Card = styled.button<{ $selected: boolean }>`
  display: grid; gap: 6px; text-align: left; width: 100%; padding: 11px 12px;
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

export function toModelArea(card: AnatomyCardData): Area {
  if (card.model === "human") {
    const target: [number, number, number] = [card.offset[0], 1.7 + card.offset[1] * .5, card.offset[2]];
    const nerveLike = /cranial nerves|nerve plexuses|peripheral nerves|spinal cord|autonomic pathways|sensory pathways|skin sensation maps/i.test(card.group)
      || /nervous system|cranial nerve|nerve|plexus|dermatome|cutaneous|ganglion|tract|pathway/i.test(card.name);
    return { name: card.name, position: [target[0], target[1] + .12, target[2] + .6], target, meshName: "o_ADBody", highlightType: nerveLike ? "nerve" : "region" };
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
  "Brachialis": [{ name: "Musculocutaneous nerve", relation: "motor supply to this elbow flexor" }, { name: "Primary motor cortex", relation: "voluntary arm movement" }],
  "Brachioradialis": [{ name: "Radial nerve", relation: "motor supply to this forearm muscle" }, { name: "Primary motor cortex", relation: "voluntary arm movement" }],
  "Trapezius": [{ name: "Cranial nerve XI Accessory", relation: "motor supply, with cervical contributions to upper trapezius" }],
  "Pectoralis major": [{ name: "Brachial plexus", relation: "pectoral nerve branches carry its motor supply" }, { name: "Primary motor cortex", relation: "voluntary pushing and reaching" }],
  "Latissimus dorsi": [{ name: "Brachial plexus", relation: "thoracodorsal nerve branches from this plexus" }, { name: "Primary motor cortex", relation: "voluntary pulling and climbing actions" }],
  "Supraspinatus": [{ name: "Brachial plexus", relation: "suprascapular nerve carries its motor supply" }, { name: "Deltoid", relation: "both contribute to arm abduction" }],
  "Infraspinatus": [{ name: "Brachial plexus", relation: "suprascapular nerve carries its motor supply" }, { name: "Teres minor", relation: "both assist external rotation and shoulder stability" }],
  "Teres minor": [{ name: "Brachial plexus", relation: "axillary nerve carries its motor supply" }, { name: "Infraspinatus", relation: "both assist external rotation and shoulder stability" }],
  "Subscapularis": [{ name: "Brachial plexus", relation: "upper and lower subscapular nerves carry its motor supply" }],
  "Pronator teres": [{ name: "Median nerve", relation: "motor supply to forearm pronation" }],
  "Supinator": [{ name: "Radial nerve", relation: "motor supply to forearm supination" }],
  "Flexor digitorum superficialis": [{ name: "Median nerve", relation: "motor supply to most finger flexors" }, { name: "Primary motor cortex", relation: "voluntary finger movement" }],
  "Flexor digitorum profundus": [{ name: "Median nerve", relation: "motor supply to the index and middle portions" }, { name: "Ulnar nerve", relation: "motor supply to the ring and little-finger portions" }],
  "Extensor digitorum": [{ name: "Radial nerve", relation: "motor supply to wrist and finger extensors" }, { name: "Primary motor cortex", relation: "voluntary finger extension" }],
  "Extensor indicis": [{ name: "Radial nerve", relation: "motor supply to this index-finger extensor" }],
  "Flexor pollicis longus": [{ name: "Median nerve", relation: "anterior interosseous branch supplies this thumb flexor" }],
  "Extensor pollicis longus": [{ name: "Radial nerve", relation: "posterior interosseous branch supplies this thumb extensor" }],
  "Extensor pollicis brevis": [{ name: "Radial nerve", relation: "posterior interosseous branch supplies this thumb extensor" }],
  "Abductor pollicis longus": [{ name: "Radial nerve", relation: "posterior interosseous branch supplies this thumb muscle" }],
  "Intrinsic hand muscles": [{ name: "Ulnar nerve", relation: "motor supply to most interossei and intrinsic hand muscles" }, { name: "Median nerve", relation: "motor supply to several thenar and lumbrical muscles" }, { name: "Primary somatosensory cortex", relation: "tactile feedback during precise hand use" }],
  "Lumbricals of the hand": [{ name: "Median nerve", relation: "supplies the first two lumbricals" }, { name: "Ulnar nerve", relation: "supplies the third and fourth lumbricals" }],
  "Dorsal interossei of the hand": [{ name: "Ulnar nerve", relation: "motor supply to the dorsal interossei" }, { name: "Primary motor cortex", relation: "fine finger movement" }],
  "Palmar interossei of the hand": [{ name: "Ulnar nerve", relation: "motor supply to the palmar interossei" }, { name: "Primary motor cortex", relation: "fine finger movement" }],
  "Facial expression muscles": [{ name: "Cranial nerve VII Facial", relation: "motor supply to most facial expression muscles" }],
  "Zygomaticus major": [{ name: "Cranial nerve VII Facial", relation: "motor supply to facial expression muscle" }, { name: "Emotion and affective networks", relation: "movement can accompany many feelings and social contexts" }],
  "Levator palpebrae superioris": [{ name: "Cranial nerve III Oculomotor", relation: "skeletal motor supply for upper-eyelid elevation" }, { name: "Superior tarsal muscle", relation: "works with smooth muscle tone to hold the eyelid elevated" }],
  "Superior tarsal muscle": [{ name: "Sympathetic division", relation: "autonomic input contributes to upper-eyelid tone" }, { name: "Levator palpebrae superioris", relation: "cooperates in eyelid elevation" }],
  "Superior rectus": [{ name: "Cranial nerve III Oculomotor", relation: "motor supply to this extraocular muscle" }],
  "Inferior rectus": [{ name: "Cranial nerve III Oculomotor", relation: "motor supply to this extraocular muscle" }],
  "Medial rectus": [{ name: "Cranial nerve III Oculomotor", relation: "motor supply for inward eye movement" }],
  "Lateral rectus": [{ name: "Cranial nerve VI Abducens", relation: "motor supply for outward eye movement" }],
  "Superior oblique": [{ name: "Cranial nerve IV Trochlear", relation: "motor supply to this extraocular muscle" }],
  "Inferior oblique": [{ name: "Cranial nerve III Oculomotor", relation: "motor supply to this extraocular muscle" }],
  "Cricothyroid": [{ name: "Superior laryngeal nerve", relation: "external branch supplies motor fibers for pitch adjustment" }, { name: "Vocal Cords", relation: "changes vocal-fold tension during phonation" }],
  "Posterior cricoarytenoid": [{ name: "Recurrent laryngeal nerve", relation: "motor supply to this intrinsic laryngeal muscle" }, { name: "Vocal Cords", relation: "opens the glottis for breathing" }],
  "Lateral cricoarytenoid": [{ name: "Recurrent laryngeal nerve", relation: "motor supply to this intrinsic laryngeal muscle" }, { name: "Vocal Cords", relation: "closes part of the glottis during voicing" }],
  "Thyroarytenoid and vocalis": [{ name: "Recurrent laryngeal nerve", relation: "motor supply to these intrinsic laryngeal muscles" }, { name: "Vocal Cords", relation: "adjusts vocal-fold tension and voice quality" }],
  "Interarytenoid muscles": [{ name: "Recurrent laryngeal nerve", relation: "motor supply to most interarytenoid fibers" }, { name: "Vocal Cords", relation: "closes the back of the glottis" }],
  "Genioglossus": [{ name: "Cranial nerve XII Hypoglossal", relation: "motor supply to most tongue muscles" }, { name: "Broca region", relation: "language production network also coordinates with speech motor systems" }],
  "Hyoglossus": [{ name: "Cranial nerve XII Hypoglossal", relation: "motor supply to this tongue muscle" }, { name: "Broca region", relation: "tongue movement contributes to articulation" }],
  "Styloglossus": [{ name: "Cranial nerve XII Hypoglossal", relation: "motor supply to this tongue muscle" }, { name: "Broca region", relation: "tongue movement contributes to articulation" }],
  "Palatoglossus": [{ name: "Cranial nerve X Vagus", relation: "motor supply via the pharyngeal plexus" }, { name: "Medulla oblongata", relation: "brainstem networks coordinate swallowing" }],
  "Intrinsic tongue muscles": [{ name: "Cranial nerve XII Hypoglossal", relation: "motor supply to intrinsic tongue muscles" }, { name: "Broca region", relation: "tongue shape changes support articulation" }],
  "Gluteus maximus": [{ name: "Gluteus medius", relation: "works with it to extend and stabilize the hip during gait" }, { name: "Inferior gluteal nerve", relation: "motor supply for powerful hip extension" }],
  "Gluteus medius": [{ name: "Gluteus minimus", relation: "works with it in hip abduction and pelvic stabilization" }, { name: "Superior gluteal nerve", relation: "motor supply to this muscle and gluteus minimus" }],
  "Gluteus minimus": [{ name: "Gluteus medius", relation: "deep partner for hip abduction and pelvic stability" }, { name: "Superior gluteal nerve", relation: "motor supply to this muscle and gluteus medius" }],
  "Tensor fasciae latae": [{ name: "Superior gluteal nerve", relation: "motor supply to this hip and thigh muscle" }],
  "Piriformis": [{ name: "Sciatic nerve", relation: "sciatic nerve usually passes below this deep hip muscle, with anatomical variation" }, { name: "Gluteus maximus", relation: "superficial muscle overlying the deep gluteal rotators" }],
  "Obturator internus": [{ name: "Superior gemellus", relation: "shares tendon region and external-rotation action" }, { name: "Inferior gemellus", relation: "shares tendon region and external-rotation action" }],
  "Superior gemellus": [{ name: "Obturator internus", relation: "assists the same deep hip rotation and stabilization" }],
  "Inferior gemellus": [{ name: "Obturator internus", relation: "assists the same deep hip rotation and stabilization" }],
  "Quadratus femoris": [{ name: "Obturator internus", relation: "nearby deep hip external rotator" }, { name: "Sciatic nerve", relation: "nearby nerve; muscle and nerve are separate structures" }],
  "Iliopsoas": [{ name: "Lumbar plexus", relation: "psoas receives direct lumbar branches; iliacus is supplied by the femoral nerve" }],
  "Adductor longus": [{ name: "Obturator nerve", relation: "motor supply to most medial thigh adductors" }],
  "Adductor magnus": [{ name: "Obturator nerve", relation: "supplies its adductor portion" }, { name: "Sciatic nerve", relation: "tibial division supplies its hamstring portion" }],
  "Gracilis": [{ name: "Obturator nerve", relation: "motor supply to this medial thigh muscle" }],
  "Sartorius": [{ name: "Femoral nerve", relation: "motor supply to this thigh muscle" }],
  "Rectus femoris": [{ name: "Femoral nerve", relation: "motor supply to the quadriceps group" }],
  "Vastus lateralis": [{ name: "Femoral nerve", relation: "motor supply to the quadriceps group" }],
  "Vastus medialis": [{ name: "Femoral nerve", relation: "motor supply to the quadriceps group" }],
  "Vastus intermedius": [{ name: "Femoral nerve", relation: "motor supply to the quadriceps group" }],
  "Biceps femoris": [{ name: "Sciatic nerve", relation: "motor supply to the hamstring portions" }],
  "Semitendinosus": [{ name: "Sciatic nerve", relation: "motor supply to the hamstring group" }],
  "Semimembranosus": [{ name: "Sciatic nerve", relation: "motor supply to the hamstring group" }],
  "Soleus": [{ name: "Tibial nerve", relation: "motor supply to this calf muscle" }],
  "Gastrocnemius": [{ name: "Tibial nerve", relation: "motor supply to this calf muscle" }],
  "Tibialis posterior": [{ name: "Tibial nerve", relation: "motor supply to posterior lower-leg and plantar muscles" }],
  "Fibularis longus": [{ name: "Common fibular nerve", relation: "motor supply through its superficial branch" }],
  "Fibularis brevis": [{ name: "Common fibular nerve", relation: "motor supply through its superficial branch" }],
  "Extensor digitorum longus": [{ name: "Common fibular nerve", relation: "motor supply through its deep branch" }],
  "Extensor hallucis longus": [{ name: "Common fibular nerve", relation: "motor supply through its deep branch" }],
  "Flexor digitorum longus": [{ name: "Tibial nerve", relation: "motor supply to this deep posterior muscle" }],
  "Flexor hallucis longus": [{ name: "Tibial nerve", relation: "motor supply to this deep posterior muscle" }],
  "Intrinsic foot muscles": [{ name: "Tibial nerve", relation: "most plantar intrinsic muscles are supplied by its branches" }, { name: "Common fibular nerve", relation: "supplies the small extensor digitorum brevis group" }],
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
    const bodyArea = PHYSIOLOGY_AREAS.find((area) => area.name === name);
    if (bodyArea) {
      setSelectedArea(bodyArea);
      setModelVariant("human");
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
