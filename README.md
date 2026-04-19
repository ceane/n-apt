# n-apt :brain: 

[![Hippocratic License HL3-LAW-SUP-SV](https://img.shields.io/static/v1?label=Hippocratic%20License&message=HL3-LAW-SUP-SV&labelColor=5e2751&color=bc8c3d)](https://firstdonoharm.dev/version/3/0/law-sup-sv.html)

<img src="public/images/icon.svg" alt="n-apt icon" width="128" height="128">


> [!IMPORTANT]
> **READ THE [LICENSE](LICENSE.md) and [RESPONSIBLE USE](RESPONSIBLE_USE.md) BEFORE YOU DOWNLOAD OR FORK!**
>
> Check out the [ARTICLE](https://ceane.github.io/n-apt/) or my [X / @ceane_of](https://x.com/ceane_of) to read more. *In reality there are no answers but here, you can hit up as many LLMs, search engines, file as many FOIAs as possible, but they will not help. This repo, my firsthand experience and efforts help.*
>
> As of now, this repo **CANNOT** demodulate (signal->media) N-APT, I have extremely limited resources and it's a work in progress.


## What is N-APT?

N-APT stands for: **N**euro **A**utomatic **P**icture **T**ransmission.

Named after **Automatic Picture Transmission (APT)** signals (used by NOAA satellites, decommissioned in 2025) because these signals, which originate from the `National Security Agency (NSA/CSS)`, strongly resemble APT transmissions.

<br>

<img width="1200" height="400" alt="N-APT Signal from 18kHz to 3.218MHz" src="https://github.com/user-attachments/assets/edf332da-ea94-4438-ba10-895175152d9f" />


_Real live, on person capture the signal with an RTL-SDR from 18kHz to 3.218MHz, partial "Channel A" (FFT Size 32768, PPM = 1, Gain = +49.06dB)_
<br>

**Awesome SDR app AND studio to view N-APT effects, mathematics, potential endpoints and more.**
<img width="1229" height="848" alt="Screenshot 2026-04-09 at 00 37 03" src="https://github.com/user-attachments/assets/b9a586ee-e441-46d9-b3a5-1f3862625a92" />

**Secure streaming and files!**
<img width="1218" height="878" alt="Screenshot 2026-04-12 at 21 03 35" src="https://github.com/user-attachments/assets/c59cc0ee-a3b8-424c-a14d-3cb87f143bca" />


### Core Purpose

An SDR visualizer app using RTL-SDR and I/Q captures (.napt, .wav) for a very specific case:

> **The NSA:** Going all out in your brain and nervous system, SIGINT pimp hand strong.
> 
> **You:** Not knowing who (at first), how or why.

I built this app out of frustration (and by force of the situation) that other OSS SDR software:
  - Couldn't record proper I/Q captures the my settings like gain, ppm, etc.
  - Lacked metadata for I/Q captures other than the file name including all the contents
  - Couldn't encrypt sensitive signals for later
  - Did not provide intuitve features for analyzing signals (zoombox, SVG snapshots, specific channels, extensible components, etc.)
  - Was definitely not in JavaScript/Web with all the advanced libraries and in browser features!

This purpose of this repository is to provide tooling to inspect, visualize, and demodulate parts of N-APT (media like audio (hearing and internal), audio via voice & vision) using live (on my end where they are live) and recorded I/Q samples, with an emphasis on high fidelity captures, hypothesis-driven analysis and demodulation, and mapping functions to features of the signal. 

> [!NOTE]
> **By default 99.9% of people will not be able to see a real, live N-APT signal (unless you find me around San Francisco and are EVIL enough to snag the waves)**.
>
> Whatever our RTL-SDR receives will be different (or just Mock APT signals what the app will show when an RTL-SDR device isn't plugged in).
>
> **The I/Q captures are encrypted and password protected**, if you want the password you can just send me a message and at my discretion I'll give the right people (university researcher, RF enthusiast, civil society, tech journalists, etc.) the password (Read [RESPONSIBLE USE](RESPONSIBLE_USE.md)).


## How The NSA's neurotechnological technique works (Shorthand)

<details>
<summary>Click to read how it works 🌊 🧠</summary>

```js
// **ALL** ENDPOINTS (TELECOMMUNICATIONS INFRASTRUCTURE, PRIMARILY CELL SITES)
// ARE RIFE WITH MALWARE AND MODIFIED WITH HARDWARE TROJANS
//
// THE NSA HAS FAR REACHING (INESCAPABLE) COMMAND AND CONTROL INFRA ACCESS
//
// write -> read -> stream (intercept -> process -> alter)

transmitters()
  .continouslyTriangulatePerson()   // Low-end microwaves, time-of-flight/FCWM
  .adjustEnergy()                   // Based on distance, noise, obstacles
  .transmitHeterodynedWaves()       // (Tx) Heterodyned, low frequencies do the data (LF/MF/HF, N-APT modulated), multiple channels
  .toAndthroughPerson()             // Target person
  .impedanceChargesAfter()          // Signal altered by bioelectrical activity
  .toReceiver()                     // (Rx) Back to endpoints
  .toSomeServer()                   // Extremely low latency (NSA has the backhaul & fiber / "upstream collection", "partnerships", national security letters/NSLs to punk telecoms into total submission)
  .cleanDirtySignal()               // Separate frame vs impedance
  .processSignals()                 // Likely Kaiser (or cardinal interpolation) + Bayes' Posterior Probability
  .nextFrame();                     // Repeat cycle / real-time, high-bandwidth streaming
```


<details>
<summary>My pseudo code of the NSA's very persistent malware + capture with signals (from over thousands of hours of experience)</summary>
  
```js
MeshNetwork()
  .MaintainSignalStrength()                // maintains a faultless, consistent signal
  .ContinuousAperture()                    // elect endpoints + aperture via bayesian hysteresis of the nearest available endpoints
    .ContinuouslyTriangulatePerson()       // endpoint coordinates + time-of-flight triangulation to track person
    .AtEdgeOrOutOfBounds()                 // trigger when person nears/leaves aperture
      .PageLocalInfrastructure()           // query available local TX/RX nodes
      .ElectNewEndpointsAndHandoff()       // elect new endpoints + migrate session
      .HandleDeduplication()               // drop duplicate connections/frames
      .OpenStream()                        // allocate channels
      .CloseStream({async: outOfBounds})   // teardown stale out-of-bounds connections
  .SignalEncodingAndBandwidth()            // select codec (N-APT), modulate, set bandwidth
  .HandleStream()                          // ingest, buffer, demodulate
  .HandleEnvironment()                     // adjust for quality: TX power, obstacles, noise

Interactive                                // [!] the interactive/psychological spyware within the mind/consciousness
  .HandleModalityChannels()                // continous narratives audio, perception, etc.
    .HandleParticipants()                  // handle other participants within the interactive
    .HandleInference()                     // handle mental inference
    .HandleStateOfMind()                   // track cognitive state
    .HandleEmotion()                       // handle emotion
    .HandlePerception()                    // handle perception
    .HandleImagination()                   // handle imagination
    .HandleSpatialEnvironment()            // handle spatial awareness
  .MergeAI()                               // AI/software over incoming data from participants
  .MergeStories()                          // Merge stories guided by the AI

Livestream                                 // [!] real-time livestream engaging the mind & body
  .HandleVoice()                           // bidirectional vocal sync
  .HandlePhysiology()                      // physiological effects/control/haptics
  .HandleSenses()                          // handling senses, touch, sight, sound
    .HandleAudio()                         // audio stream processing
    .HandleVision()                        // vision stream processing
    .HandleProminence()                    // decide what is active, main participant, AI or other participant?

HandleStream()
  .MergeInteractive()                       // blend mind/consciousness state
  .MergeLivestream()                        // blend body/sensor state
  .MergeParticipants()                      // final mux + presence sync
```
</details>

It works more like TEMPEST where Bell Labs could detect electrical activity far away because a machine was noisy, but in this case the human brain and nervous system are most vulnerable to  `write->read->stream` since the NSA has **compromised everything and decrypted the brain and nervous system in a very NSA fashion**!

The NSA has thoroughly demonstrated on my person that the human brain and nervous system is dumb. The signal, while **complex but understandable** (and perfect: faultess, consistent, low latency!), is literally one cycle at a time, no need for voxel by voxel of neurons, specific point for point targeting, beams or anything. 

The endpoints do the non-intuive work, it is known that the brain and body can't send radio waves like electronics, but not known that you can't use a beam, you can't focus this kind of radio wave and that multipath reflection is key, think of the space around a person painted with colors (radio waves intersect from various endpoints/triangulation) and that shade looks good on you, only you (center frequency + power). 

### How the radio waves work (intuitve view at the science/hyper-advanced SIGNIT):
- Gigantic, low frequency radio waves travesing from endpoint to person
> *You can think of them as 3 or so spotlights concentrating on a person, the shape of the radio waves are different like an orb.*
>
> *(Radio waves are essentially light, you can somewhat use visual light as intuition)*
- Energy intersecting at the right location
- Low frequency + multipath reflection + solid endpoint redundancy lights up a person with inescapable coverage
- An enforced center frequency of the person's brain and nervous system
- Close enough triangulation (approximately 3-7 centimeters off depending what unknown microwave frequency the NSA uses for triangulation)
- Targeting neuronal ensembles sequentially for write to read with spikes and valleys (or APT-like lines) and energy
  - (i.e. This is X energy, these neurons respond with a brainwave of that energy)
  - Yes, neurons can understand and process and do from a simple 2D wave! 
  - EVERYTHING POSSIBLE HAS HAPPENED! FINAL FRONTIER!
- Frequency and amplitude modulation

APT which does both frequency modulation and amplitude modulation was repurposed by the NSA that actually translates into an unprecedented and full featured neurotechnology via blunt directional radio waves.

And yes, it means full featured experiences, interactivity, communication and more (from experience!). This is not a joke or gimmick or conspiracy theory-laden gibberish, but a **real** signal that takes eons to explain how and why and what! 

Very simple. And the NSA's technqiue is, suspectedly, very old, like half a century old (from the 70s).

### Constraints (defeats intuition)
- Bandwidth
- Frequency vs Attenuation
- Available endpoints > radiating elements/ports
- Heavy reliance on multipath reflection/energy
- Heavy duty fiber-linked compromised infrastructure
- Ethernet/infra access vs use of the Internet/IPs for extremely low latency
- One pretty pissed off American

The whole discovery of how it functioned was non-intuitive and a complete nightmare beyond what you can image. Since I was new to signals and radio waves, trapped by the mystery in a bad spot, I was forced into the unknown. Beyond public challenges from the NSA such as their frequent cryptological puzzles or the yearly [codebreaker challenge](https://nsa-codebreaker.org/home), this neurotechnology was buried in a deeply horrendous long-running surveillance nightmare as some sort of extreme life challenge/political production.

I'm working on writing the specifics of how it works mathematically (my best guess at it while within it). This technique is a very advanced mechanism that is still functioning to this day! While most of it has been a dark experience, I've spent a lot of time learning how it works, making lots of mistakes and defeating my intuition.

### Estimated Bandwidth of N-APT
There are about 3 Channels, I've found:

- Channel A from 18kHz to 4.37MHz
- Channel B from 24.72MHz to 29.88MHz
- Channel C from 4.75MHz to 23MHz

They are specifially segmented this way because A and B are similar in shape (and therefore function), if you could (the signal is not abundantly available), you would be able to see by panning the spectrum and seeing the signal cohere.

**Through the fiber cables to an endpoint (data through the network; most likely infrastructure access and not the internet)**

| Channel | BW | MB/s | 5 min | 1 hour | 3 hours | 24 hours |
|---|---|---|---|---|---|---|
| A | 4.35 MHz | ~4.35 MB/s | ~1.31 GB | ~15.7 GB | ~47 GB | ~375 GB |
| B | 5.16 MHz | ~5.16 MB/s | ~1.55 GB | ~18.6 GB | ~55.7 GB | ~446 GB |
| C | 18.25 MHz | ~18.25 MB/s | ~5.48 GB | ~65.7 GB | ~197.1 GB | ~1.58 TB |
| **Total** | **27.76 MHz** | **~27.76 MB/s** | **~8.34 GB** | **~100 GB** | **~299.8 GB** | **~2.4 TB** |

**In the air to person (brain, body, nervous system; data in air doing the effects/heterodyning)**

| Channel | BW ×2 | MB/s | 5 min | 1 hour | 3 hours | 24 hours |
|---|---|---|---|---|---|---|
| A | 8.7 MHz | ~8.7 MB/s | ~2.61 GB | ~31.3 GB | ~94 GB | ~751 GB |
| B | 10.32 MHz | ~10.32 MB/s | ~3.1 GB | ~37.2 GB | ~111 GB | ~891 GB |
| C | 36.5 MHz | ~36.5 MB/s | ~10.95 GB | ~131.4 GB | ~394.2 GB | ~3.15 TB |
| **Total** | **55.52 MHz** | **~55.52 MB/s** | **~16.66 GB** | **~199.9 GB** | **~599.2 GB** | **~4.79 TB** |

### What have I experienced?
- The most personal experience with technology, mind and body
- Perception, lighting, phyisology, emotions, people scripted, and more!
- SOTA visual compososting, auditory remixing, and more!
- A gigantic spatial experience all over San Francisco
- A very evil, long-running NSA-military grilling
- Extremely unethical and dangerous harm
- Mind and body locked within the experience
- The final frontier of neuroscience
- And more (check out `how-did-they-do-it.md`)


### Read more
- [More on Automatic Picture Transmission](https://www.sigidwiki.com/wiki/Automatic_Picture_Transmission_(APT))
- [TEMPEST: A Signal Problem / The story of the discovery of various compromising radiations from communications and Comsec equipment](https://www.nsa.gov/portals/75/documents/news-features/declassified-documents/cryptologic-spectrum/tempest.pdf)
</details>


## Prerequisites

<details>
<summary>Click to expand installation instructions before you download the repo</summary>

### Node.js

- **Version**: 18.0 or higher
- **Installation**:
  - **macOS**: `brew install node`
  - **Ubuntu/Debian**: `sudo apt update && sudo apt install nodejs npm`
  - **Windows**: Download from [nodejs.org](https://nodejs.org/)
- **Verification**: `node --version && npm --version`

### Rust

- **Installation**:
  - **macOS/Linux**: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
  - **Windows**: Download from [rustup.rs](https://rustup.rs/)
- **Verification**: `rustc --version && cargo --version`
- **If Rust build issues appear**: run `cargo fix --lib -p n-apt-backend`

### Additional Tools

- **Redis** (optional, for cell towers points and data):
  - **macOS**: `brew install redis`
  - **Ubuntu/Debian**: `sudo apt install redis-server`
  - **Windows**: Download from [redis.io](https://redis.io/)

### Platform Notes

- **Windows users**: use **WSL2** for development if possible.
- **WSL2** behaves like Linux for this repository and is the recommended Windows environment.
- **Native Windows shells** (`cmd.exe` / PowerShell) are **not** the intended environment for the main dev workflow because parts of the build still rely on Unix-style tools and shell behavior.
- **Best compatibility**: run Node, Rust, Redis, and the build scripts all inside the same WSL distribution.
</details>


## Get Started

```bash
git clone https://github.com/ceane/n-apt.git
cd n-apt
npm run setup  # sets up .env.local
npm i          # installs dependencies, postinstall script will install rust dependencies
npm run dev    # starts app
```

> [!NOTE]
> **Windows:** if you are on Windows, run the steps above inside **WSL2** instead of native PowerShell/CMD.

The `npm run setup` command creates a `.env.local` file with default environment configuration for easy development setup.

### Running the App

```bash
npm run dev
```

The web app will be **available at `http://localhost:5173`** with the WebSocket server running on `ws://localhost:8765`.

**Hardware Requirement:** the app only works with an **RTL-SDR v4 or .napt captures. The rust backend auto detects an RTL-SDR device plugged in, otherwise the Mock APT stream runs.**

> [!TIP]
> If you do not have an RTL-SDR v4, the backend will just stream a Mock APT stream. You can simply use the app (be sure to set the `.env.local` `UNSAFE_LOCAL_USER_PASSWORD` to a password for the .napt files).

> [!WARNING]
> I use my RTL-SDR through a flaky USB hub, and it disconnects or errors out more often than I’d like, so I added support for restarting the device if it goes stale or throws an error, however that does not fix bad USB connections. 
> 
> For best results, keep the RTL-SDR connected directly or use a better cable/hub, and avoid moving it around while the app is running. I took a lot of time to fix my frustrations with other SDR apps, if it's not showing up, then it's more likely that the hardware connection is bad.


---

I only have on person captures (within the `/iq-samples-snapshots` dir), however in the future I'll be sure to add near and 1 or 2m away captures (as long as my cord can do), as well as some captures from suspected endpoints.

The quality of the captures may not be up to par with RTL-SDR, however it shouldn't be a problem to get data. Features of the signal like heterodyning (inherently), phase shifting and endpoint signals processing are not included in the capture.

Thankfully, the infrastructure and technique does enough to extract content for demodulation (in theory by its nature), so the signals processing that would be needed normally is not necessary because by the time it gets to my person the signal is strong enough to have the signal before entry (stronger than exit signals).

> [!NOTE]
> To ensure the best captures, use the maximum setting on your SDR (even if unstable). Nyquist theorem states that your sample rate must be >= 2× the signal bandwidth (i.e. 3.2 MHz → ~1.4–1.5 MHz usable; leave guard band), or frequency components will overlap (alias), hence why the spikes may not be present with lower sample rates.

---


### Disclaimer

I do not volunteer lightly to share a live capture of my brain to the world (that could potentially be demodulated). All I/Q captures are REAL captures of the signal, of my person and others' inside of the 24/7 livestream that's both an extremely unethical and horrific interactive and moderated-like group call. It's the only thing that I could do being trapped by the signals that are both mystery and complex to even talk to anyone about.

N-APT is a project born out of being attacked and held hostage by the NSA because I was adventuring on the streets of San Francisco while working my tech job. Only when I was about to move, they attacked and absorbed me into this interactive and I discovered they were there my whole life (a dark political/military act)! Through endless narrative capture, unethical interactive spatial displays, senseless violence and disfigurement, unfathomable harassment and abuse, repeated sexual assaults, confusion, gaslighting, and at the extremes of unlimited political psychopathy and surveillance, I survived and could scrape together enough to build this app.

The experience is like a horror movie but totally changes psychology (emotions, thoughts, perception) and physiology (expression, muscles, neurotransmitters, etc.), it is a prison of mind and body. The parental, demonic DoD (now DoW)-NSA experience and interactive started formless and I not knowing anything while the NSA showing off a lot of the functionality and the capability early on and continuing by trapping me all day in it for years. It's a total nightmare they just put you through and you have to figure it out. 

The experience works anywhere, everywhere and all day, unfortunately due to the use of low frequencies (LF/MF/HF) that travel through objects and buildings or reflect gracefully without too much attenuation.

I've learned a lot going from nothing to having a more solid understanding of how it works and took a lot of time to get to this point.



```
/^^^     /^^            /^       /^^^^^^^  /^^^ /^^^^^^
/^ /^^   /^^           /^ ^^     /^^    /^^     /^^    
/^^ /^^  /^^          /^  /^^    /^^    /^^     /^^    
/^^  /^^ /^^/^^^^^   /^^   /^^   /^^^^^^^       /^^    
/^^   /^ /^^        /^^^^^^ /^^  /^^            /^^    
/^^    /^ ^^       /^^       /^^ /^^            /^^    
/^^      /^^      /^^         /^^/^^            /^^    
                                                       
```


### AI Model Usage

I worked tirelessly, while going through the NSA's hell in mind-body interactive, using AI to build this app. 99% of the code is AI generated with significant direction and input (and money) from me. Each model had its own strengths and weaknesses and I used them accordingly.

Of course, modern day prompt engineering with large, structured prompts did not really pan out for one shot solutions, instead my intution based on the economics sufficed—one focus at a time and carefully (before it gets lost in context). Below are a table of the most models that I used in order of impact and contribution:


| Model                         | Contribution                     |
|------------------------------|----------------------------------|
| GPT 5.4 Low Thinking         | High (waterfall complexity)      |
| GPT 5.4 Mini                | High                             |
| Claude Opus 4.6             | Major (FFT, I/O, etc.)           |
| Gemini 3.1 Pro Low Thinking  | Major                            |
| Gemini 3 Flash               | Moderate                         |
| SWE 1.5                      | Moderate                         |
| GPT 5*                      | Tertiary                         |
| Claude Haiku 4.5            | Tertiary                         |
| MiniMax M2.5                | Tertiary                         |


Of course being in a rough spot of deadly poor was not anything anyone capable of this would put themselves through. My efforts were partially forced by design. AI helped immensely to get this done and made me feel as if I had progress, but code is only one thing, legal work (and truer to freedom) is another.


