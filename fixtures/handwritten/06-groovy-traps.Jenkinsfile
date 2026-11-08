#!/usr/bin/env groovy
@Library('my-shared-lib@v2') _

// Top-level Groovy that is not part of the declarative model
def REGIONS = ['eu-west-1', 'us-east-1']
def notify(String msg) {
    echo "notify: ${msg}"   // a { brace } inside a string
}

/* block comment with pipeline { stages { } } inside */
pipeline {
    agent {
        kubernetes {
            yaml '''
apiVersion: v1
kind: Pod
spec:
  containers:
  - name: maven
    image: maven:3.9 # { not a brace }
'''
        }
    }
    environment {
        TOKEN = credentials('api-token')
        GREETING = "Hello ${env.BUILD_ID}"
    }
    stages {
        stage("Build ${env.BRANCH_NAME}") {
            steps {
                container('maven') {
                    sh 'mvn -B package'
                }
                script {
                    def m = "a{b}c" =~ /\{.*\}/
                    for (r in REGIONS) {
                        echo "region ${r}"
                    }
                    def path = $/C:\temp\{x}/$
                }
            }
        }
        stage('Shared lib step') {
            steps {
                deployToK8s(namespace: 'apps', chart: 'web')
                notify 'done'
            }
        }
    }
}
