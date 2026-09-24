package main

import (
	"encoding/json"
	"fmt"
	"os"
	"syncforge/internal/crdt"
)

func main() {
	var cases []struct {
		Ops []crdt.Op `json:"ops"`
	}
	if e := json.NewDecoder(os.Stdin).Decode(&cases); e != nil {
		panic(e)
	}
	out := []string{}
	for _, c := range cases {
		d := crdt.New()
		if e := d.Apply(c.Ops); e != nil {
			fmt.Fprintln(os.Stderr, e)
			os.Exit(1)
		}
		out = append(out, d.Text())
	}
	json.NewEncoder(os.Stdout).Encode(out)
}
