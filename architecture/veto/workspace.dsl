/*
 * Veto — pin every fact with a hash and a fetch time, cite pins not pages, and revalidate the pinned
 * basis before anything ships. Refuse with a receipt when the world moved.
 *
 * THE CODE IS THE SOURCE, AND EVERY COMPONENT SAYS WHICH FILE IT IS. Read from veto/ at d00bdb4.
 * Each component carries a "code" property naming its files, and architecture/drift.mjs refuses a
 * push where the two disagree: a source file no component claims, a component whose file is gone, or
 * an import between two components the model draws no line for.
 *
 * ONE PROCESS, NO SERVER. Veto is a command-line run (veto/demo.sh) over a SQLite file and three JSONL
 * ledgers. There is no web app; the console screens elsewhere in this repo read the ledgers.
 *
 * THE TRACES ARE THREE BECAUSE A DYNAMIC VIEW CANNOT BRANCH. gate.revalidate() returns CLEAN, DRIFTED
 * or UNREACHABLE; each is its own story: the clean night ships, the villain night is refused with a
 * receipt, the outage refuses without a comparison.
 */
workspace "Veto" "A deterministic ship-time gate for agent reports: pin facts by hash, cite pins, re-validate the basis, refuse drift with a receipt." {

    !adrs adrs

    model {
        operator = person "Operator" "Runs veto/demo.sh, mock or --real, and reads the verdict on the terminal."
        judge = person "Judge / Verifier" "Inspects pins, receipts and counts; recomputes a hash if they want to."

        amazon = softwareSystem "Retailer product pages" "The live pages whose price, stock, rating, seller and title are pinned." {
            tags "Existing System"
        }
        nimble = softwareSystem "Nimble MCP server" "mcp.nimbleway.com/mcp, Streamable HTTP; nimble_extract returns each page as markdown and structured content." {
            tags "Existing System"
        }
        liquidHost = softwareSystem "Liquid model host" "Ollama on-device (LFM2.5-1.2B-Instruct, LFM2-1.2B-Extract) or OpenRouter (liquid/lfm-2.5-2.6b:free)." {
            tags "Existing System"
        }
        tinybird = softwareSystem "Tinybird" "Holds vault_events; the vault_evidence and vault_volatility endpoints serve counts, gate p95 and fact volatility." {
            tags "Existing System"
        }

        veto = softwareSystem "Veto" "Pins facts, writes a pin-cited report, revalidates the pinned basis before ship, and refuses drift with a receipt." {

            cli = container "Veto CLI" "One Node process per run; state is a SQLite file and three JSONL ledgers beside the code." "Node.js 22 · TypeScript · node:sqlite" {
                adapters = component "Fetch seam" "FetchAdapter with a deterministic mock and the Nimble MCP client; the parser that turns a page into five facts." "TypeScript · fetch" {
                    properties {
                        "code" "veto/adapters.ts"
                    }
                }
                conformance = component "Conformance check" "R10: the Nimble adapter's FetchResult keys equal the mock's." "TypeScript" {
                    properties {
                        "code" "veto/conformance.ts"
                    }
                }
                liquid = component "Liquid client" "One chat call for every model use, on-device or OpenRouter; a quota circuit breaker." "TypeScript · fetch" {
                    properties {
                        "code" "veto/liquid.ts"
                    }
                }
                extract = component "Corroborator" "L1: a second extractor (Liquid) must agree with the parser before a page's facts are pinned; disagreeing pages are held." "TypeScript" {
                    properties {
                        "code" "veto/extract.ts"
                    }
                }
                agent = component "Report writer" "Liquid writes JSON claims over pinned facts; a deterministic checker repairs or drops every claim." "TypeScript" {
                    properties {
                        "code" "veto/agent.ts"
                    }
                }
                pins = component "Pin store" "Content-addressed pins in a SQLite file: pin_id = sha256(canonical fact)[:12], fetched_at, source_url; resolve() re-hashes." "node:sqlite" {
                    properties {
                        "code" "veto/pins.ts"
                    }
                }
                report = component "Report composer" "Fetch, corroborate, pin, compose: every claim cites a pin; writes a draft only." "TypeScript" {
                    properties {
                        "code" "veto/report.ts"
                    }
                }
                gate = component "Revalidation gate" "Pure function: re-fetch every cited source, re-hash, compare. CLEAN, DRIFTED or UNREACHABLE. No model inside." "TypeScript" {
                    properties {
                        "code" "veto/gate.ts"
                    }
                }
                receipts = component "Refusal receipts" "Append-only receipts.jsonl: refused_at, reason, drifted_facts, error, pin_hashes, basis_window, explanation." "JSONL" {
                    properties {
                        "code" "veto/receipts.ts"
                    }
                }
                ship = component "Ship decision" "The only path that writes report.md: draft, gate, ship on CLEAN, else receipt and optional re-base; appends runs.jsonl." "TypeScript" {
                    properties {
                        "code" "veto/ship.ts"
                    }
                }
                worlds = component "World injectors" "PriceShift and Outage wrap any adapter so the same drift runs on mock or live data." "TypeScript" {
                    properties {
                        "code" "veto/worlds.ts"
                    }
                }
                scenario = component "Villain scenario" "18:00 fetch and pin, overnight draft, 21:00 competitor drops 15 percent, 06:00 gate." "TypeScript" {
                    properties {
                        "code" "veto/scenario.ts"
                    }
                }
                simulate = component "Simulator" "--clean, --drift, --outage worlds for the red proofs." "TypeScript" {
                    properties {
                        "code" "veto/simulate.ts"
                    }
                }
                verify = component "Pin verifier" "Every [pin:] and [was-pin:] in a report resolves to an untampered row, or exit 1." "TypeScript" {
                    properties {
                        "code" "veto/verify_pins.ts"
                    }
                }
                evidence = component "Evidence counts" "North star, counter and gate p95 computed from pins.db, receipts.jsonl and runs.jsonl; Tinybird must agree or local wins." "TypeScript" {
                    properties {
                        "code" "veto/evidence.ts"
                    }
                }
                stream = component "Event emitter" "Fire-and-forget event posts to Tinybird as they happen; a dropped event is repaired by the next sync." "TypeScript · fetch" {
                    properties {
                        "code" "veto/stream.ts"
                    }
                }
                tinybirdClient = component "Tinybird read path" "Ingests events and reads the vault_evidence pipe; never inside the gate." "TypeScript · fetch" {
                    properties {
                        "code" "veto/tinybird.ts,veto/tinybird/datasources/vault_events.datasource,veto/tinybird/endpoints/vault_evidence.pipe,veto/tinybird/endpoints/vault_volatility.pipe"
                    }
                }
                demo = component "Demo runner" "One command: reset, night 1 clean, night 2 villain, evidence." "bash" {
                    properties {
                        "code" "veto/demo.sh"
                    }
                }
                proofs = component "Red proofs" "R1 to R22: adversarial checks that the mechanism cannot be fooled." "bash" {
                    properties {
                        "code" "veto/redproofs_p1.sh,veto/redproofs_p2.sh,veto/redproofs_p3.sh"
                    }
                }
                skill = component "Agent Skill" "The cite-pins rule in Nimble's Agent Skills format; describes only what is built." "Markdown" {
                    properties {
                        "code" "veto/skill/SKILL.md"
                    }
                }
            }
        }

        /* PEOPLE. Enduring wording: what each person does, not a step. */
        operator -> demo "Runs, mock or --real"
        operator -> proofs "Runs before advancing a phase"
        judge -> receipts "Reads the refusal and its basis window from"
        judge -> pins "Recomputes a hash against"
        judge -> evidence "Reads the counts from"

        /* INSIDE THE CLI. Every line here is an import in veto/, plus the shell callers. */
        demo -> scenario "Runs night 1 (--clean) and night 2 through"
        demo -> evidence "Prints the counts through"
        proofs -> simulate "Runs the clean, drift and outage worlds through"
        proofs -> report "Drafts through"
        proofs -> gate "Greps and calls"
        proofs -> verify "Verifies citations through"
        proofs -> ship "Ships a forged report through"
        proofs -> adapters "Checks the adapter seam in"
        proofs -> agent "Runs the claim checker in"
        proofs -> worlds "Wraps adapters with"
        proofs -> scenario "Runs the villain through"
        proofs -> pins "Tampers a temp copy of"
        proofs -> conformance "Runs"
        proofs -> evidence "Compares pipe and local counts through"
        conformance -> adapters "Compares FetchResult keys from"
        scenario -> adapters "Gets the adapter from"
        scenario -> ship "Drafts and decides through"
        scenario -> worlds "Wraps the world with PriceShift from"
        scenario -> pins "Counts cited pins with"
        simulate -> adapters "Gets the adapter from"
        simulate -> ship "Drafts and decides through"
        simulate -> worlds "Wraps the world with PriceShift or Outage from"
        ship -> adapters "Gets the adapter from"
        ship -> report "Builds the draft through"
        ship -> gate "Revalidates the cited basis through"
        ship -> pins "Reads cited pin ids with"
        ship -> agent "Runs the checker over the explanation with"
        ship -> receipts "Appends a refusal to"
        ship -> stream "Emits run and check events through"
        report -> adapters "Fetches every page through"
        report -> extract "Corroborates each page through"
        report -> pins "Pins every fact in"
        report -> agent "Asks for verified claims from"
        report -> gate "Reads the Drift type from"
        extract -> adapters "Canonicalises values with"
        extract -> liquid "Asks the extraction model through"
        agent -> liquid "Asks the writer model through"
        gate -> pins "Re-hashes and parses facts with"
        gate -> adapters "Re-fetches through"
        pins -> adapters "Reads the FetchResult shape from"
        worlds -> adapters "Wraps"
        worlds -> pins "Targets a cited fact with"
        receipts -> gate "Reads the Verdict type from"
        verify -> pins "Resolves each citation in"
        evidence -> pins "Counts pins in"
        evidence -> receipts "Sums drifted facts from"
        evidence -> ship "Reads runs.jsonl from"
        evidence -> stream "Builds the event list with"
        evidence -> tinybirdClient "Reads the pipe through"
        stream -> tinybirdClient "Formats timestamps with"

        /* OUTSIDE. */
        adapters -> nimble "initialize, tools/list, tools/call nimble_extract" "JSON-RPC over Streamable HTTP"
        nimble -> amazon "Renders and extracts"
        liquid -> liquidHost "chat/completions" "HTTPS or localhost"
        tinybirdClient -> tinybird "POST /v0/events, GET /v0/pipes/vault_evidence.json" "HTTPS"
        stream -> tinybird "POST /v0/events" "HTTPS, fire-and-forget" {
            tags "Asynchronous"
        }

        deploymentEnvironment "Demo" {
            deploymentNode "Operator's laptop" "Everything local: the run, the SQLite file, the ledgers, the on-device models." "macOS · Node 22 · Ollama" {
                containerInstance cli
                softwareSystemInstance liquidHost
            }
            deploymentNode "Nimble cloud" "" "SaaS" {
                softwareSystemInstance nimble
            }
            deploymentNode "Tinybird cloud" "" "SaaS" {
                softwareSystemInstance tinybird
            }
        }
    }

    views {
        systemContext veto "Context" "Who runs Veto, what it reads, and the three services it talks to." {
            properties {
                "structurizr.tooltips" "true"
            }
            include *
            autoLayout lr 500 400
        }

        container veto "Containers" "One CLI process; state is files beside it." {
            properties {
                "structurizr.tooltips" "true"
            }
            include *
            autoLayout lr 500 400
        }

        component cli "Modules" "Fetch seam, pin store, composer, gate, receipts and the runners; the gate imports no model." {
            properties {
                "structurizr.tooltips" "true"
            }
            include *
            autoLayout lr 500 400
        }

        /* THE CLEAN NIGHT. The basis holds; the gate re-hashes 25 pins and the report ships. */
        dynamic cli "Ship" "Night 1: nothing moved between fetch and ship; CLEAN, report.md written." {
            properties {
                "structurizr.tooltips" "true"
            }
            operator -> demo "bash veto/demo.sh"
            demo -> scenario "scenario.ts --clean"
            scenario -> ship "draft(adapter)"
            ship -> report "buildReport(): fetch five pages"
            report -> adapters "fetch(url) x5"
            adapters -> nimble "tools/call nimble_extract (--real)"
            report -> extract "corroborate(): parser and Liquid agree"
            report -> pins "pinResult(): five facts per page"
            report -> agent "agentAnalysis(): JSON claims, checked"
            scenario -> ship "decide(text, world)"
            ship -> gate "revalidate(): re-fetch, re-hash, compare"
            gate -> adapters "fetch(url) x5, again"
            ship -> stream "emit(run CLEAN)"
            autoLayout lr 500 400
        }

        /* THE VILLAIN NIGHT. One cited price moves 15 percent; the gate refuses and writes the receipt. */
        dynamic cli "Refuse" "Night 2: a competitor price drops 15 percent after the draft cited it; DRIFTED, REFUSED, receipt with explanation." {
            properties {
                "structurizr.tooltips" "true"
            }
            operator -> demo "bash veto/demo.sh"
            demo -> scenario "scenario.ts"
            scenario -> ship "draft(adapter)"
            ship -> report "buildReport(): fetch, corroborate, pin, claims"
            scenario -> worlds "new PriceShift(adapter, cited price, x0.85)"
            scenario -> ship "decide(text, shifted world)"
            ship -> gate "revalidate(): re-fetch through the shifted world"
            gate -> adapters "fetch(url) x5"
            ship -> receipts "appendReceipt(DRIFTED, explanation)"
            ship -> stream "emit(run REFUSED, checks)"
            demo -> evidence "evidence.ts: N pinned, M drifted, 0 shipped contradictions"
            autoLayout lr 500 400
        }

        /* THE OUTAGE. No comparison is possible; fail closed, report.md untouched. */
        dynamic cli "Outage" "A fetch fails at revalidation; UNREACHABLE, REFUSED, report.md byte-identical." {
            properties {
                "structurizr.tooltips" "true"
            }
            operator -> proofs "bash veto/redproofs_p2.sh (R5)"
            proofs -> simulate "simulate.ts --outage"
            simulate -> ship "draft(adapter), then decide(text, Outage(adapter))"
            ship -> gate "revalidate(): first fetch rejects"
            gate -> adapters "fetch(url) throws"
            ship -> receipts "appendReceipt(UNREACHABLE, error)"
            autoLayout lr 500 400
        }

        deployment veto "Demo" "Deployed" "Everything runs on the operator's laptop; Nimble and Tinybird are called over HTTPS." {
            include *
            autoLayout lr 500 400
        }

        /* GENERATED FROM architecture/theme.json by checks/diagram-contrast.mjs --write.
           Edit the theme, not this block: the check refuses any drift between them. */
        styles {
            element "Element" {
                color #ffffff
                strokeWidth 2
                fontSize 26
            }
            element "Person" {
                shape Person
                background #32433b
                stroke #6fa588
            }
            element "Existing System" {
                background #32433b
                stroke #6fa588
            }
            element "Software System" {
                background #494d97
                stroke #a5a9f0
            }
            element "Container" {
                background #5f64af
                stroke #b9bdf5
            }
            element "Component" {
                background #8b92ce
                stroke #d2d5fa
                color #14162b
            }
            element "Data Store" {
                shape Cylinder
                background #5f64af
                stroke #b9bdf5
            }
            element "Channel" {
                shape Pipe
                background #5f64af
                stroke #b9bdf5
            }
            element "Deployment Node" {
                background #1F2226
                stroke #9aa4b2
                color #ffffff
            }
            element "Infrastructure Node" {
                background #5f64af
                stroke #b9bdf5
                color #ffffff
            }
            element "Modified" {
                stroke #ffb454
                strokeWidth 4
            }
            element "Proposal" {
                stroke #ff2fd0
                strokeWidth 6
            }
            element "Container Instance" {
            }
            element "Software System Instance" {
            }
            relationship "Relationship" {
                color #d7dbe3
                fontSize 24
            }
            relationship "Asynchronous" {
                color #d7dbe3
                fontSize 24
                dashed true
            }
        }
    }
}
