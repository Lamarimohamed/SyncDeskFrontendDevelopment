# Real-Network Validation Guide

## Current readiness

The current implementation is an in-process virtual-time simulator. It does not
open TCP sockets, provide a server process, or validate real packet behavior.
Therefore it has not validated GNS3, TCP/IP retransmissions, or Wireshark captures.
Real-network experiments require a backend-only transport and process boundary before
the scenarios below can be executed.

## Proposed topology

Use three independent backend nodes connected through a GNS3 topology, for example:
`node-a -- router/switch -- node-b` and `node-c` on a separate link or namespace.
Assign stable private addresses and record the topology, interface names, MTU, and
clock policy. Each node must be assigned a stable replica ID independently of its IP.

The transport must carry the existing versioned state-sync messages and expose the
application run ID, message ID, sender ID, and receiver ID in structured logs. The
current simulator is not that transport.

## Scenarios

Repeat the documented stable-connectivity, short-partition, long-partition,
offline-reconnect, delay/jitter, loss, duplicate, and reorder scenarios. Use the
same seed, workload configuration, and observation window as the in-process run.
Apply faults with a controlled network emulator or GNS3 link configuration, not
arbitrary manual sleeps.

## Wireshark capture and accounting

Capture at each relevant node interface and preserve one PCAP per run. Associate
captures with application results using the run ID in the application log and a
capture start/end timestamp. Protocol filters depend on the eventual transport;
for TCP use `tcp.port == <port>`, and for a framed application protocol inspect
the decoded payload after establishing the framing.

Report separately:

1. application payload bytes from the UTF-8 protocol boundary;
2. acknowledgement and retry payload bytes;
3. TCP payload bytes and retransmissions from packet capture;
4. TCP/IP/Ethernet framing overhead.

These values are not interchangeable. Preserve raw PCAP files, raw JSONL results,
topology configuration, fault configuration, and command output together.

## Repetition and limitations

Run multiple fixed seeds and do not discard failed or non-converged runs. A run that
does not converge within its observation window records a null convergence time.
Until a transport is implemented and tested independently of the frontend, this
guide is a readiness plan rather than evidence of real-network behavior.

## Environment check

The repository currently has no backend server entry point or socket transport.
GNS3 and Wireshark availability must be checked on the experiment host; their
absence does not affect the in-process tests. Install and validate those tools
separately from this repository before attempting a capture. The current evidence
is limited to deterministic simulator behavior and application-level byte counts.
