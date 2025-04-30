module requester

go 1.23.0

toolchain go1.23.8

require github.com/masa-finance/tee-worker v1.0.0

require (
	github.com/edgelesssys/ego v1.5.4 // indirect
	github.com/go-jose/go-jose/v4 v4.0.4 // indirect
	github.com/google/uuid v1.6.0 // indirect
	github.com/sirupsen/logrus v1.9.3 // indirect
	golang.org/x/crypto v0.36.0 // indirect
	golang.org/x/exp v0.0.0-20240904232852-e7e105dedf7e // indirect
	golang.org/x/sys v0.31.0 // indirect
)

// Force Go to ignore the Go version requirement in the masa-finance/tee-worker module
replace github.com/masa-finance/tee-worker => github.com/masa-finance/tee-worker v1.0.0
