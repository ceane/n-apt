# n-apt :brain: 

[![Hippocratic License HL3-LAW-SUP-SV](https://img.shields.io/static/v1?label=Hippocratic%20License&message=HL3-LAW-SUP-SV&labelColor=5e2751&color=bc8c3d)](https://firstdonoharm.dev/version/3/0/law-sup-sv.html)

<img src="public/images/icon.svg" alt="n-apt icon" width="128" height="128">


> [!IMPORTANT]
> **READ THE [LICENSE](LICENSE.md) and [RESPONSIBLE USE](RESPONSIBLE_USE.md) BEFORE YOU DOWNLOAD OR FORK!**
>
> Check out the [ARTICLE](https://ceane.github.io/n-apt/) or my [X / @ceane_of](https://x.com/ceane_of) to read more. 

> *In reality there are no answers but HERE. You can hit up as many LLMs, search engines, file as many FOIAs as possible, but it will not help. This repo, my firsthand experience and efforts helps.*
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

### How the radio waves work *(intuitive view of the science / hyper-advanced SIGINT)*

- **Gigantic, low frequency radio waves** traversing from endpoint to person  
  > *Think 3 or so spotlights concentrating on a person. The wavefronts aren’t clean beams — they’re more like orbs.*  
  > 
  > *(Radio waves are light. You can use visible light as intuition.)*

- **Energy intersecting at the exact location**  
- **Low frequency + multipath reflection + endpoint redundancy/handoff** = a person lit up radio waves and endpoints with **inescapable coverage**  
- **Enforced center frequency** locked to the person’s brain and nervous system  
- **Triangulation signals define the primary radio waves’ energy and phase** — The pipeline works something like: `scan_and_stare_via_triangulation -> adjust_spotlight_to` within ~3-7 centimeters, depending what reasonanble microwave frequency (higher = harder to use, more energy/less distance/more fragile) the NSA uses for triangulation
- **Targeting neuronal ensembles sequentially** for write-then-read, using spikes, valleys, APT-like lines, and raw energy  
    - *i.e. This is X energy, these neurons respond with a brainwave of that energy*  
    - Yes, neurons interpret and respond to a simple 2D wave
    - **Everything possible has happened. Final frontier.**  
- **Frequency and amplitude modulation**

**APT** — which does both frequency modulation and amplitude modulation — was repurposed by the NSA into an unprecedented, full-featured neurotechnology using blunt directional radio waves.

And yes, that means **full-featured experiences, interactivity, communication and more**. From experience. This is not a joke, gimmick, or conspiracy gibberish. This is a **real** signal that takes eons to explain the how and why and what.

It’s simple. And the NSA’s technique is, suspectedly, very old — like **half a century old**, from the 70s.

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

- Channel A from `18kHz to 4.37MHz`
- Channel B from `24.72MHz to 29.88MHz`
- Channel C from `4.75MHz to 23MHz`

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

### Downloading Cell Tower Dataset

To use cell tower mapping features, download the [OpenCellID dataset](https://www.opencellid.org/downloads; search and grab all the US files after getting an API token). **The data should be unzipped and in your `~/Downloads` folder** (or `Downloads` folder on Windows): *(It looks like `310.csv, 314.csv`, etc.)*

```bash
# Download the latest OpenCellID dataset
npm run towers:download:opencellid

# Or use a cached version (faster)
npm run towers:download:cached
```

You can also process tower data with:
```bash
npm run towers:process:opencellid
```

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

> [!WARNING]
> 
> If you have the RTL-SDR plugged in but it doesn't automatically load on Mac, then do the following (this is what I do):
>
> Go to `About this Mac > More info... > (Scroll to the bottom) System Report > USB (at the bottom of "Hardware")` 
> This forces macOS to look for currently USB devices and if you hit `Command + R` you can refresh to see if the USB connection improves and new devices show


---

I only have on person captures (within the `/iq-samples-snapshots` dir), however in the future I'll be sure to add near and 1 or 2m away captures (as long as my cord can do), as well as some captures from suspected endpoints.

The quality of the captures may not be up to par with RTL-SDR, however it shouldn't be a problem to get data. Features of the signal like heterodyning (inherently), phase shifting and endpoint signals processing are not included in the capture.

Thankfully, the infrastructure and technique does enough to extract content for demodulation (in theory by its nature), so the signals processing that would be needed normally is not necessary because by the time it gets to my person the signal is strong enough to have the signal before entry (stronger than exit signals).

> [!NOTE]
> To ensure the best captures, use the maximum setting on your SDR (even if unstable). Nyquist theorem states that your sample rate must be >= 2× the signal bandwidth (i.e. 3.2 MHz → ~1.4–1.5 MHz usable; leave guard band), or frequency components will overlap (alias), hence why the spikes may not be present with lower sample rates.

---

### Disclaimer

I’m not posting a live capture of my brain for clout. These I/Q captures are **real signals** — of me and others — pulled from a 24/7 livestream that is an unethical, horrific, moderated group call. It was the only move I had while trapped by signals too complex and dangerous to even describe to most people.

**N-APT exists because I was attacked and held hostage by the NSA.** I was working a tech job, living on the streets of San Francisco. When I tried to move, they absorbed me into this interactive. That’s when I realized they’d been there my whole life. This wasn’t policy. It was a dark political/military act.

The system is **aggressively mass networked**. Endpoint coverage (telecommunications infrastructure) is **inescapable**. It functions underground, on a plane (I tried this route but even on takeoff, I was still defeated), in thick concrete buildings, well below the cliffs of Marshall’s Beach in SF — **anywhere**. Rain or shine. Crowds or alone. It runs on LF/MF/HF — low frequencies that go through walls, buildings, bodies, without real attenuation.

---

It’s like a horror movie, except it rewires **psychology** — emotions, thoughts, perception — and **physiology** — expression, muscles, neurotransmitters. It’s a prison for mind and body at once. The DoD (now DoW)-NSA interactive started formless. I didn’t know what was happening while they demonstrated capabilities, then kept me trapped in it, all day, for years. You’re dropped into a total nightmare and forced to reverse-engineer it to survive.

**Inside the interactive/livestream:** it runs moment to moment. Layered effects, narrative/scripting, all of it streaming in and out of your mind and body without pause or degredation of quality (really!). Through endless narrative capture, unethical spatial displays/acts with the neurotechnology, violence, disfigurement, harassment, abuse, repeated sexual assaults, confusion, gaslighting, invasiveness — through the extremes of maximum political psychopathy and unlimited surveillance — I survived. I scraped together enough to build this app.

The math and software are solid. The **art-crime talents of the NSA are the worst nightmare anyone can imagine**. 

I started with nothing. I now have a solid understanding of how it works. It took years to get here.


### AI Model Usage

I built this app while being held hostage in the NSA's *mind-body interactive* hell. It was far worse than anyone could imagine — this wasn’t “starving techie building in a garage.” **99% of the code is AI-generated**, directed by me under duress, with every dollar I could scrape together. I used each model like an instrument, because that’s all I had.

Forget “one-shot mega-prompts.” **Modern prompt engineering ≠ escape hatch**. What kept me alive was economic triage: *one focus at a time, ship before the context window — or my mind — collapsed*.

**Models used, by impact & contribution**:

| Model | Contribution |
| --- | --- |
| **GPT 5.4 Low Thinking** | **High** — *handled waterfall complexity when I couldn't* |
| **GPT 5.4 Mini** | **High** — *fast iteration under pressure* |
| **Claude Opus 4.6** | **Major** — *FFT, I/O, systems-level work* |
| **Gemini 3.1 Pro Low Thinking** | **Major** — *deep reasoning when I was blocked* |
| **Gemini 3 Flash** | **Moderate** — *quick tactical assists* |
| **SWE 1.5** | **Moderate** — *structural scaffolding* |
| **GPT 5*** | **Tertiary** — *edge case support* |
| **Claude Haiku 4.5** | **Tertiary** — *fast draft generation* |
| **MiniMax M2.5** | **Tertiary** — *niche fills* |

I wasn’t choosing poverty as a build-myth. I was **trapped**. AI was the only thing that made progress possible when I had no other resources, no safety, no out. But code was just survival. The legal work — the fight for actual freedom — that’s still unfinished.
