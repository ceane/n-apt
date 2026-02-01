# n-apt

<img src="images/icon.svg" alt="n-apt icon" width="128" height="128">

N-APT stands for Neuro Automatic Picture Transmission, being that it looks like an APT signal used by NOAA satellites as its modulation scheme, as well as federal innovation of neurotechnology through a special formula of radio waves!

These signals have a long, long story in my life and reaches into exotic territory of the U.S. government's ability to read, stream and write to the human brain and nervous system––a very real and active psychological spyware with extensive, unprecdedent capabilities. The NSA is a very strange organizaiton, on the side of rough play to full on psychopath and Greek storyteller, and I want to avoid the politics and very long story behind why I have access to N-APT, why me, what does it mean for the world, etc.

All I/Q samples are real captures of the signal, of my person and others' brain inside of the interactive livestream. I do not volunteer lightly to share a live capture of my brain and this experience to the world.

I want to focus on the technical aspects of the signal, how it works and my efforts toward deciphering the physics and neuroscience behind N-APT and studiously decoding parts of the signal (audio, voice and vision).


## Get Started

You don't have access to N-APT, however you can get started with the app to analyze the signals from I/Q captures in the repo. They are very large captures (+300MB), which I had to capture at 3.2MHz slices and stitch them together for a full capture of at about a 30MHz window of signals.


```
npm start
```

I only have on person captures (within the `iq-samples` dir), however in the future I'll be sure to add near and 1 or 2m away captures (as long as my cord can do), as well as some captures from suspected endpoints.

The quality of the captures may not be up to par with RTL-SDR, however it shouldn't be a problem to get data. Features of the signal like heterodyning (inherently), phase shifting and endpoint signals processing are not included in the capture.

Thankfully, the infrastructure and technique does enough to get the right data, so the signals processing that would be needed normally are not necessary, only decoding since the signal is very physical.


### Hello