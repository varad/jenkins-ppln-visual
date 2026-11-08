pipeline {
    agent none
    options { parallelsAlwaysFailFast() }
    stages {
        stage('Lint') {
            agent { docker { image 'golangci/golangci-lint:v1.59' } }
            steps { sh 'golangci-lint run' }
        }
        stage('Tests') {
            failFast true
            parallel {
                stage('Linux') {
                    agent { label 'linux' }
                    steps { sh 'go test ./...' }
                    post { always { junit 'report.xml' } }
                }
                stage('Windows') {
                    agent { label 'windows' }
                    steps { bat 'go test ./...' }
                }
                stage('macOS') {
                    agent { label 'mac' }
                    options { retry(2) }
                    steps { sh 'go test ./...' }
                }
            }
        }
        stage('Release') {
            agent any
            when { buildingTag() }
            steps { sh 'goreleaser release' }
        }
    }
}
