// Package crdt is an independent RGA reference implementation.
package crdt

import (
	"errors"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"
)

type Op struct {
	ID     string `json:"id"`
	Kind   string `json:"kind"`
	After  string `json:"after"`
	Value  string `json:"value,omitempty"`
	Target string `json:"target,omitempty"`
}

var idPattern = regexp.MustCompile(`^[1-9][0-9]{0,14}:[a-zA-Z0-9_-]{1,64}$`)

func Clock(id string) (int64, error) {
	if !idPattern.MatchString(id) {
		return 0, errors.New("invalid operation ID")
	}
	n, _ := strconv.ParseInt(strings.SplitN(id, ":", 2)[0], 10, 64)
	return n, nil
}
func Validate(op Op) error {
	n, err := Clock(op.ID)
	if err != nil {
		return err
	}
	switch op.Kind {
	case "insert":
		if !utf8.ValidString(op.Value) || utf8.RuneCountInString(op.Value) != 1 || op.Target != "" {
			return errors.New("invalid insertion")
		}
		if op.After != "" {
			p, e := Clock(op.After)
			if e != nil || p >= n {
				return errors.New("invalid parent")
			}
		}
	case "delete":
		p, e := Clock(op.Target)
		if e != nil || p >= n || op.Value != "" || op.After != "" {
			return errors.New("invalid deletion")
		}
	default:
		return errors.New("unknown operation")
	}
	return nil
}

type Document struct{ operations map[string]Op }

func New() *Document { return &Document{operations: map[string]Op{}} }
func (d *Document) Apply(ops []Op) error {
	staged := map[string]Op{}
	for _, op := range ops {
		if err := Validate(op); err != nil {
			return err
		}
		if old, ok := d.operations[op.ID]; ok && old != op {
			return errors.New("conflicting operation ID")
		}
		if old, ok := staged[op.ID]; ok && old != op {
			return errors.New("conflicting operation ID")
		}
		staged[op.ID] = op
	}
	for id, op := range staged {
		d.operations[id] = op
	}
	return nil
}
func (d *Document) Text() string {
	children := map[string][]Op{}
	deleted := map[string]bool{}
	for _, op := range d.operations {
		if op.Kind == "delete" {
			deleted[op.Target] = true
		} else {
			children[op.After] = append(children[op.After], op)
		}
	}
	for key := range children {
		sort.Slice(children[key], func(i, j int) bool {
			a, b := children[key][i].ID, children[key][j].ID
			an, _ := Clock(a)
			bn, _ := Clock(b)
			if an == bn {
				return a > b
			}
			return an > bn
		})
	}
	stack := []Op{}
	push := func(list []Op) {
		for i := len(list) - 1; i >= 0; i-- {
			stack = append(stack, list[i])
		}
	}
	push(children[""])
	var out strings.Builder
	for len(stack) > 0 {
		n := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		if !deleted[n.ID] {
			out.WriteString(n.Value)
		}
		push(children[n.ID])
	}
	return out.String()
}
