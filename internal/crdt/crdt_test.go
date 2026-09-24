package crdt

import (
	"fmt"
	"math/rand"
	"testing"
)

func TestPermutations(t *testing.T) {
	ops := []Op{{ID: "1:a", Kind: "insert", Value: "a"}, {ID: "2:a", Kind: "insert", After: "1:a", Value: "😀"}, {ID: "3:a", Kind: "insert", After: "2:a", Value: "c"}, {ID: "4:a", Kind: "delete", Target: "2:a"}, {ID: "5:b", Kind: "insert", After: "1:a", Value: "b"}}
	for seed := int64(0); seed < 500; seed++ {
		r := rand.New(rand.NewSource(seed))
		r.Shuffle(len(ops), func(i, j int) { ops[i], ops[j] = ops[j], ops[i] })
		d := New()
		for _, op := range ops {
			if err := d.Apply([]Op{op, op}); err != nil {
				t.Fatal(err)
			}
		}
		if d.Text() != "abc" {
			t.Fatalf("%d: %q", seed, d.Text())
		}
	}
}
func TestAtomic(t *testing.T) {
	d := New()
	d.Apply([]Op{{ID: "1:a", Kind: "insert", Value: "a"}})
	if d.Apply([]Op{{ID: "2:a", Kind: "insert", Value: "b"}, {ID: "1:a", Kind: "insert", Value: "c"}}) == nil {
		t.Fatal("expected conflict")
	}
	if d.Text() != "a" {
		t.Fatal(d.Text())
	}
}
func TestDeepChain(t *testing.T) {
	d := New()
	ops := []Op{}
	after := ""
	for i := 1; i <= 20000; i++ {
		id := fmt.Sprintf("%d:a", i)
		ops = append(ops, Op{ID: id, Kind: "insert", After: after, Value: "x"})
		after = id
	}
	if e := d.Apply(ops); e != nil {
		t.Fatal(e)
	}
	if len(d.Text()) != 20000 {
		t.Fatal("chain lost")
	}
}
